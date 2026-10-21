/*
 * KiranaMitra - app.js  (Smart Stock. Simple Dukaan.)
 * The UI only: it reads forms, calls Stock.* (stock.js) and draws the page.
 * Data is saved in localStorage, so everything works offline.
 * All text is inserted with textContent (never innerHTML), so typed names cannot inject HTML.
 */
(function () {
  'use strict';

  var KEY = 'kirana.v1'; // unchanged from the first version, so already-saved shop data keeps working
  var MAX_HISTORY = 30;
  var TABS = ['overview', 'inventory', 'low', 'reorder', 'dataset'];
  var DATASET_KEY = 'kirana.dataset.summary.v1';
  var pendingDataset = null;
  var datasetSummary = loadDatasetSummary();
  var bundledDatasetLoadStarted = false;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var state = load();
  var ui = { tab: 'overview', query: '', lowFilter: 'all', serverSeq: 0 };
  var modalStack = [];
  var pendingConfirm = null;
  var move = { type: 'sale' };
  var editSku = '';
  var toastTimer = null;

  // ---------- tiny DOM helpers ----------
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  // o = { cls, icon, text, label, title, disabled, onClick }
  function button(o) {
    var b = el('button', 'btn' + (o.cls ? ' ' + o.cls : ''));
    b.type = 'button';
    if (o.icon) b.appendChild(icon(o.icon));
    if (o.text) b.appendChild(el('span', null, o.text));
    if (o.label) { b.setAttribute('aria-label', o.label); b.title = o.label; }
    if (o.title) b.title = o.title;
    if (o.disabled) b.disabled = true;
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }

  function emptyBlock(iconName, title, text, actions) {
    var d = el('div', 'empty');
    d.appendChild(icon(iconName));
    d.appendChild(el('strong', null, title));
    if (text) d.appendChild(el('span', null, text));
    if (actions && actions.length) {
      var row = el('div', 'btn-row');
      actions.forEach(function (a) { row.appendChild(a); });
      d.appendChild(row);
    }
    return d;
  }

  function statusChip(p) {
    var s = Stock.stockStatus(p);
    return el('span', 'chip ' + s, s === 'out' ? 'Out of stock' : s === 'low' ? 'Low stock' : 'In stock');
  }

  function byName(a, b) {
    var x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function findProduct(sku) {
    var key = Stock.normalizeSku(sku);
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].sku === key) return state.products[i];
    }
    return null;
  }

  function todayLabel() {
    return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function timeLabel(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  var errorUntil = 0;
  function toast(message, kind) {
    // an error (e.g. "could not save") must not be hidden by a success message right after it
    if (Date.now() < errorUntil && kind !== 'error') return;
    if (kind === 'error') errorUntil = Date.now() + 4000;
    var t = $('toast');
    t.textContent = message;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  // ---------- storage (localStorage) ----------
  function emptyState() { return { products: [], history: [] }; }

  function loadDatasetSummary() {
    try { var value = localStorage.getItem(DATASET_KEY); return value ? JSON.parse(value) : null; } catch (e) { return null; }
  }
  function saveDatasetSummary() {
    try { localStorage.setItem(DATASET_KEY, JSON.stringify(datasetSummary)); return true; }
    catch (e) { toast('Dataset summary could not be saved in this browser. Re-import the CSV after reload.', 'error'); return false; }
  }

  function cleanHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (m) {
      return m && (m.type === 'sale' || m.type === 'restock') && typeof m.name === 'string' &&
        Number.isInteger(m.qty) && m.qty > 0 && typeof m.time === 'string';
    }).slice(0, MAX_HISTORY);
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      var data = JSON.parse(raw);
      return { products: Stock.cleanProducts(data.products), history: cleanHistory(data.history) };
    } catch (e) {
      return emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save on this device (storage blocked or full). Changes may be lost when you close this page.', 'error');
    }
  }

  function commit() { save(); render(); }

  // ---------- tabs ----------
  function showTab(name) {
    if (TABS.indexOf(name) === -1) return;
    ui.tab = name;
    TABS.forEach(function (t) {
      var on = t === name;
      var btn = $('tabbtn-' + t);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    render();
    if (name === 'dataset') autoLoadBundledDataset();
  }

  // Load an optional bundled CSV from public/data without requiring file selection.
  // The historical dataset is summarized separately and never touches live shop stock.
  function autoLoadBundledDataset() {
    if (bundledDatasetLoadStarted || datasetSummary) return;
    bundledDatasetLoadStarted = true;
    $('dataset-message').textContent = 'Checking for bundled dataset…';
    fetch('data/retail_store_inventory.csv', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('No bundled CSV found.');
      return response.text();
    }).then(function (csv) {
      var parsed = KiranaDataset.parseCSV(csv);
      var result = KiranaDataset.analyze(parsed);
      datasetSummary = Object.assign({}, result, {
        fileName: 'retail_store_inventory.csv', importedAt: new Date().toISOString(),
        sourceUrl: '', licenseNotes: 'Bundled local dataset. Verify and document the dataset licence before public deployment.'
      });
      saveDatasetSummary();
      $('dataset-message').textContent = 'Bundled dataset loaded automatically. Historical records remain separate from live shop inventory.';
      renderDatasetSummary();
    }).catch(function () {
      $('dataset-message').textContent = 'No bundled dataset found. Put retail_store_inventory.csv in public/data/ or use Choose CSV.';
      bundledDatasetLoadStarted = false;
    });
  }

  // ---------- rendering ----------
  function render() {
    renderStats();
    renderOverview();
    renderInventory();
    renderLow();
    renderReorder();
    renderDatasetSummary();
  }

  function renderStats() {
    var t = Stock.totals(state.products);
    $('stat-products').textContent = t.products;
    $('stat-low').textContent = t.low;
    $('stat-out').textContent = t.out;
    $('stat-units').textContent = t.units.toLocaleString('en-IN');
    var badge = $('badge-low');
    badge.hidden = t.low === 0;
    badge.textContent = t.low;
  }

  function renderOverview() {
    var has = state.products.length > 0;
    $('ov-empty').hidden = has;
    $('ov-grid').hidden = !has;
    if (!has) return;

    var t = Stock.totals(state.products);
    var low = Stock.lowStock(state.products);

    // Needs attention
    var box = $('ov-attention');
    box.textContent = '';
    $('ov-viewall').hidden = low.length === 0;
    $('ov-viewall-count').textContent = '(' + low.length + ')';
    if (!low.length) {
      box.appendChild(emptyBlock('check', 'All stock levels are healthy', 'Nothing needs reordering right now.'));
    } else {
      low.slice(0, 7).forEach(function (p) {
        var row = el('div', 'mini-row');
        var info = el('div', 'grow');
        info.appendChild(el('strong', null, p.name));
        info.appendChild(el('small', null, p.quantity + ' left · reorder at ' + p.threshold));
        row.appendChild(info);
        row.appendChild(statusChip(p));
        row.appendChild(button({ cls: 'sm', icon: 'up', text: 'Restock', onClick: function () { openMove('restock', p.sku); } }));
        box.appendChild(row);
      });
    }

    // Stock health bar
    var total = t.products || 1;
    $('hb-ok').style.width = (t.healthy / total * 100) + '%';
    $('hb-low').style.width = (t.lowOnly / total * 100) + '%';
    $('hb-out').style.width = (t.out / total * 100) + '%';
    $('hl-ok').textContent = t.healthy;
    $('hl-low').textContent = t.lowOnly;
    $('hl-out').textContent = t.out;
    $('hbar').setAttribute('aria-label', t.healthy + ' healthy, ' + t.lowOnly + ' low, ' + t.out + ' out of stock');

    // Recent activity
    var hist = $('ov-history');
    hist.textContent = '';
    if (!state.history.length) {
      hist.appendChild(emptyBlock('cart', 'No activity yet', 'Sales and restocks will show up here.'));
    } else {
      state.history.slice(0, 7).forEach(function (m) {
        var row = el('div', 'mini-row');
        var info = el('div', 'grow');
        info.appendChild(el('strong', null, m.name));
        info.appendChild(el('small', null, (m.type === 'sale' ? 'Sale' : 'Restock') + ' · ' + timeLabel(m.time)));
        row.appendChild(info);
        row.appendChild(el('span', m.type, (m.type === 'sale' ? '− ' : '+ ') + m.qty));
        hist.appendChild(row);
      });
    }
  }

  // cells shared by the three product lists
  function nameCell(p, mobileLine) {
    var d = el('div', 'c-name');
    d.appendChild(el('strong', null, p.name));
    d.appendChild(el('small', null, 'SKU: ' + p.sku));
    if (mobileLine) d.appendChild(el('small', 'm-only', mobileLine));
    return d;
  }

  function qtyCell(value, status, label) {
    var d = el('div', 'c-qty');
    d.appendChild(el('span', 'num' + (status && status !== 'ok' ? ' ' + status : ''), String(value)));
    d.appendChild(el('span', 'lbl', label));
    return d;
  }

  function setListHead(listEl, isEmpty) {
    var head = listEl.previousElementSibling;
    if (head && head.classList.contains('list-head')) head.hidden = isEmpty;
  }

  function renderInventory() {
    var box = $('inventory');
    box.textContent = '';
    var all = state.products;
    var shown = Stock.searchProducts(all, ui.query).sort(byName);
    $('inv-count').textContent = ui.query.trim()
      ? 'Showing ' + shown.length + ' of ' + all.length
      : all.length + ' product' + (all.length === 1 ? '' : 's');

    if (!all.length) {
      setListHead(box, true);
      box.appendChild(emptyBlock('box', 'No products yet', 'Add your first product to start tracking stock.',
        [button({ cls: 'primary', icon: 'plus', text: 'Add product', onClick: openAdd })]));
      return;
    }
    if (!shown.length) {
      setListHead(box, true);
      box.appendChild(emptyBlock('search', 'No products match "' + ui.query.trim() + '"', 'Try a different name or SKU.'));
      return;
    }
    setListHead(box, false);

    shown.forEach(function (p) {
      var status = Stock.stockStatus(p);
      var row = el('div', 'row-item cols-inv' + (status !== 'ok' ? ' ' + status : ''));
      row.setAttribute('role', 'listitem');
      row.appendChild(nameCell(p, 'Reorder at ' + p.threshold));
      row.appendChild(qtyCell(p.quantity, status, 'in stock'));
      row.appendChild(el('div', 'c-min', String(p.threshold)));

      var foot = el('div', 'c-foot');
      var st = el('div', 'c-status');
      st.appendChild(statusChip(p));
      foot.appendChild(st);

      var act = el('div', 'c-act');
      act.appendChild(button({
        cls: 'sm primary', icon: 'cart', text: 'Sell', disabled: p.quantity === 0,
        title: p.quantity === 0 ? 'Out of stock - nothing to sell' : 'Record a sale',
        onClick: function () { openMove('sale', p.sku); }
      }));
      act.appendChild(button({ cls: 'sm', icon: 'up', text: 'Restock', onClick: function () { openMove('restock', p.sku); } }));
      act.appendChild(button({ cls: 'sm icon ghost', icon: 'edit', label: 'Edit ' + p.name, onClick: function () { openEdit(p.sku); } }));
      act.appendChild(button({ cls: 'sm icon ghost danger', icon: 'trash', label: 'Delete ' + p.name, onClick: function () { askDelete(p.sku); } }));
      foot.appendChild(act);
      row.appendChild(foot);
      box.appendChild(row);
    });
  }

  function renderLow() {
    var low = Stock.lowStock(state.products);
    var out = low.filter(function (p) { return p.quantity === 0; });
    var lowOnly = low.filter(function (p) { return p.quantity > 0; });
    $('cc-all').textContent = low.length;
    $('cc-low').textContent = lowOnly.length;
    $('cc-out').textContent = out.length;
    ['all', 'low', 'out'].forEach(function (f) {
      $('chip-' + f).setAttribute('aria-pressed', ui.lowFilter === f ? 'true' : 'false');
    });

    var list = ui.lowFilter === 'out' ? out : ui.lowFilter === 'low' ? lowOnly : low;
    var box = $('low-list');
    box.textContent = '';

    if (!list.length) {
      setListHead(box, true);
      if (!state.products.length) {
        box.appendChild(emptyBlock('box', 'No products yet', 'Add products to see low-stock alerts here.',
          [button({ cls: 'primary', icon: 'plus', text: 'Add product', onClick: openAdd })]));
      } else if (ui.lowFilter === 'all') {
        box.appendChild(emptyBlock('check', 'All stock levels are healthy', 'No product is at or below its reorder level.'));
      } else {
        box.appendChild(emptyBlock('check', ui.lowFilter === 'out' ? 'Nothing is out of stock' : 'No low-stock items',
          'Try the "All" filter to see everything that needs attention.'));
      }
      return;
    }
    setListHead(box, false);

    list.forEach(function (p) {
      var status = Stock.stockStatus(p);
      var need = p.threshold - p.quantity;
      var row = el('div', 'row-item cols-low ' + status);
      row.setAttribute('role', 'listitem');
      row.appendChild(nameCell(p, (need > 0 ? 'Short by ' + need : 'At the reorder limit') + ' · reorder at ' + p.threshold));
      row.appendChild(qtyCell(p.quantity, status, 'in stock'));
      row.appendChild(el('div', 'c-min', String(p.threshold)));
      row.appendChild(el('div', 'c-need', need > 0 ? String(need) : 'At limit'));

      var foot = el('div', 'c-foot');
      var st = el('div', 'c-status');
      st.appendChild(statusChip(p));
      foot.appendChild(st);
      var act = el('div', 'c-act');
      act.appendChild(button({ cls: 'sm primary', icon: 'up', text: 'Restock', onClick: function () { openMove('restock', p.sku); } }));
      foot.appendChild(act);
      row.appendChild(foot);
      box.appendChild(row);
    });
  }

  function renderReorder() {
    var list = Stock.reorderList(state.products);
    var box = $('reorder-list');
    box.textContent = '';
    $('ro-count').textContent = (list.length ? list.length + ' item' + (list.length === 1 ? '' : 's') + ' to order · ' : '') + todayLabel();
    $('copy-btn').disabled = !list.length;

    if (!state.products.length) {
      setListHead(box, true);
      box.appendChild(emptyBlock('box', 'No products yet', 'Add products and KiranaMitra will suggest what to reorder.',
        [button({ cls: 'primary', icon: 'plus', text: 'Add product', onClick: openAdd })]));
    } else if (!list.length) {
      setListHead(box, true);
      box.appendChild(emptyBlock('check', 'Nothing to reorder', 'All your products are above their reorder level.'));
    } else {
      setListHead(box, false);
      list.forEach(function (it) {
        var row = el('div', 'row-item cols-reorder');
        row.setAttribute('role', 'listitem');
        var name = el('div', 'c-name');
        name.appendChild(el('strong', null, it.name));
        name.appendChild(el('small', null, 'SKU: ' + it.sku));
        name.appendChild(el('small', 'm-only', 'In stock ' + it.quantity + ' · reorder at ' + it.threshold));
        row.appendChild(name);
        row.appendChild(el('div', 'c-have', String(it.quantity)));
        row.appendChild(el('div', 'c-min', String(it.threshold)));
        var q = el('div', 'c-qty');
        q.appendChild(el('span', 'order-pill', String(it.order_qty)));
        q.appendChild(el('span', 'lbl', 'to order'));
        row.appendChild(q);
        box.appendChild(row);
      });
    }

    if (ui.tab === 'reorder') verifyServer();
  }

  // ---------- reorder list: double-check with the Python API ----------
  function renderDatasetSummary() {
    var has = !!datasetSummary;
    $('dataset-results').hidden = !has;
    $('dataset-clear').disabled = !has;
    if (!has) return;
    $('ds-rows').textContent = Number(datasetSummary.rows || 0).toLocaleString('en-IN');
    $('ds-products').textContent = Number(datasetSummary.distinctProducts || 0).toLocaleString('en-IN');
    $('ds-inventory').textContent = Number(datasetSummary.totalInventory || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    $('ds-sold').textContent = Number(datasetSummary.totalSold || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    $('ds-ordered').textContent = Number(datasetSummary.totalOrdered || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    $('ds-imported-at').textContent = datasetSummary.importedAt ? 'Imported ' + timeLabel(datasetSummary.importedAt) : '';
    $('ds-file-name').textContent = datasetSummary.fileName || 'CSV dataset';
    $('ds-source-url').value = datasetSummary.sourceUrl || '';
    $('ds-license').value = datasetSummary.licenseNotes || '';
    var cb = $('ds-category-body'); cb.textContent = '';
    (datasetSummary.categories || []).slice(0, 12).forEach(function (c) {
      var tr = document.createElement('tr');
      [c.name, Number(c.rows).toLocaleString('en-IN'), Number(c.inventory).toLocaleString('en-IN', { maximumFractionDigits: 2 }), Number(c.sold).toLocaleString('en-IN', { maximumFractionDigits: 2 })].forEach(function (v) { tr.appendChild(el('td', null, String(v))); }); cb.appendChild(tr);
    });
    var rb = $('ds-restock-body'); rb.textContent = '';
    (datasetSummary.restockCandidates || []).slice(0, 12).forEach(function (c) {
      var tr = document.createElement('tr');
      [c.productId, c.category, c.inventory, Number(c.forecast).toFixed(2), c.gap].forEach(function (v) { tr.appendChild(el('td', null, String(v))); }); rb.appendChild(tr);
    });
    if (!(datasetSummary.categories || []).length) cb.appendChild(emptyTableRow(4, 'No category data available'));
    if (!(datasetSummary.restockCandidates || []).length) rb.appendChild(emptyTableRow(5, 'No restock candidates based on available columns'));
    $('ds-meta-status').textContent = '';
  }

  function emptyTableRow(span, message) {
    var tr = document.createElement('tr'), td = el('td', null, message); td.colSpan = span; tr.appendChild(td); return tr;
  }

  function showDatasetPreview(parsed, fileName) {
    pendingDataset = { parsed: parsed, fileName: fileName };
    $('dataset-preview-wrap').hidden = false;
    $('dataset-preview-count').textContent = parsed.records.length.toLocaleString('en-IN') + ' valid-shape rows';
    $('dataset-columns').textContent = 'Columns: ' + parsed.headers.join(' · ');
    var head = $('dataset-preview-head'), body = $('dataset-preview-body'); head.textContent = ''; body.textContent = '';
    var trh = document.createElement('tr');
    parsed.headers.slice(0, 8).forEach(function (h) { trh.appendChild(el('th', null, h)); });
    if (parsed.headers.length > 8) trh.appendChild(el('th', null, '…'));
    head.appendChild(trh);
    parsed.records.slice(0, 5).forEach(function (r) {
      var tr = document.createElement('tr');
      parsed.headers.slice(0, 8).forEach(function (h) { tr.appendChild(el('td', null, r[h])); });
      if (parsed.headers.length > 8) tr.appendChild(el('td', null, '…'));
      body.appendChild(tr);
    });
    $('dataset-quality').textContent = parsed.malformedRows + ' malformed rows skipped. Preview shows up to 5 records and 8 columns.';
    $('dataset-message').textContent = 'CSV parsed locally. Review the preview and confirm to calculate insights. No data has been imported yet.';
    $('dataset-import').disabled = false;
  }

  $('dataset-file').addEventListener('change', function () {
    var file = $('dataset-file').files && $('dataset-file').files[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') { toast('Choose a .csv file.', 'error'); return; }
    if (file.size > 25 * 1024 * 1024) { toast('CSV is larger than 25 MB. Please use a smaller file.', 'error'); return; }
    var reader = new FileReader();
    $('dataset-message').textContent = 'Reading ' + file.name + '…';
    reader.onerror = function () { $('dataset-message').textContent = 'Could not read this file. Try selecting it again.'; toast('CSV read failed.', 'error'); };
    reader.onload = function () {
      try {
        var parsed = KiranaDataset.parseCSV(String(reader.result));
        var analysis = KiranaDataset.analyze(parsed);
        // Keep a preview ready, but don't import until user confirms.
        showDatasetPreview(parsed, file.name);
        $('dataset-quality').textContent += ' Required data check passed. ' + analysis.validRows.toLocaleString('en-IN') + ' analyzable rows; ' + analysis.invalidNumericRows + ' rows with invalid numeric fields and ' + analysis.missingProductIds + ' missing product IDs will be excluded from calculations.';
      } catch (err) {
        pendingDataset = null; $('dataset-preview-wrap').hidden = true;
        $('dataset-message').textContent = err.message || 'Could not process this CSV.'; toast(err.message || 'CSV import failed.', 'error');
      }
    };
    reader.readAsText(file);
  });

  $('dataset-import').addEventListener('click', function () {
    if (!pendingDataset) { toast('Choose a CSV file first.', 'warn'); return; }
    try {
      var result = KiranaDataset.analyze(pendingDataset.parsed);
      datasetSummary = Object.assign({}, result, { fileName: pendingDataset.fileName, importedAt: new Date().toISOString(), sourceUrl: '', licenseNotes: '' });
      if (!saveDatasetSummary()) return;
      $('dataset-preview-wrap').hidden = true;
      $('dataset-message').textContent = 'Dataset imported successfully. Historical records are separate from live shop inventory.';
      pendingDataset = null; $('dataset-file').value = '';
      renderDatasetSummary(); toast('Dataset insights imported successfully');
    } catch (err) { toast(err.message || 'Dataset analysis failed.', 'error'); }
  });

  $('dataset-clear').addEventListener('click', function () {
    if (!window.confirm('Clear imported dataset insights? Your shop inventory will not be changed.')) return;
    datasetSummary = null; try { localStorage.removeItem(DATASET_KEY); } catch (e) {}
    $('dataset-results').hidden = true; $('dataset-clear').disabled = true;
    $('dataset-message').textContent = 'Imported dataset cleared. Your live shop inventory is unchanged.'; toast('Dataset insights cleared');
  });

  $('ds-save-meta').addEventListener('click', function () {
    if (!datasetSummary) return;
    var url = $('ds-source-url').value.trim();
    if (url && !/^https:\/\/www\.kaggle\.com\/datasets\//i.test(url)) { toast('Enter a valid Kaggle dataset URL.', 'error'); return; }
    datasetSummary.sourceUrl = url; datasetSummary.licenseNotes = $('ds-license').value.trim();
    if (saveDatasetSummary()) { $('ds-meta-status').textContent = 'Source notes saved on this browser. Verify these details against the original Kaggle page.'; toast('Dataset notes saved'); }
  });

  function setServer(kind, text, showRetry) {
    $('server-status').className = 'server' + (kind ? ' ' + kind : '');
    $('server-text').textContent = text;
    $('server-retry').hidden = !showRetry;
  }

  function verifyServer() {
    var seq = ++ui.serverSeq; // ignore answers that arrive after newer requests
    if (!state.products.length) { setServer('', 'Add products to get reorder suggestions.', false); return; }
    if (!navigator.onLine) { setServer('warn', 'You are offline. This list was calculated on your device and is still correct.', true); return; }
    if (typeof fetch !== 'function') { setServer('warn', 'Server check is not supported in this browser. Your list is still correct.', false); return; }

    setServer('', 'Checking with the KiranaMitra server…', false);
    fetch('/api/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: state.products })
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        if (seq !== ui.serverSeq) return;
        if (res.status !== 200 || !res.data || !Array.isArray(res.data.items)) {
          var why = res.data && res.data.error ? res.data.error : 'error ' + res.status;
          setServer('warn', 'The server could not check this list (' + why + '). Your list is still calculated on this device.', true);
          return;
        }
        var key = function (i) { return i.sku + ':' + i.order_qty; };
        var local = Stock.reorderList(state.products).map(key).join('|');
        var remote = res.data.items.map(key).join('|');
        if (local === remote) {
          setServer('ok', res.data.count
            ? 'Verified by the KiranaMitra server: ' + res.data.count + ' item(s), same quantities.'
            : 'Verified by the KiranaMitra server: nothing to reorder.', true);
        } else {
          setServer('warn', 'The server list differs from this device. Please report this bug to the team.', true);
        }
      })
      .catch(function () {
        if (seq !== ui.serverSeq) return;
        setServer('warn', 'Server check is unavailable right now. Your list is still calculated on this device.', true);
      });
  }

  // ---------- modals ----------
  function openModal(id, focusSelector) {
    var m = $(id);
    m._opener = document.activeElement;
    m.hidden = false;
    modalStack.push(m);
    document.body.classList.add('modal-open');
    var f = focusSelector ? m.querySelector(focusSelector) : null;
    if (!f) f = m.querySelector('input:not([readonly]), select, button');
    if (f) f.focus();
  }

  function closeModal(m) {
    if (!m || m.hidden) return;
    m.hidden = true;
    var i = modalStack.indexOf(m);
    if (i !== -1) modalStack.splice(i, 1);
    if (!modalStack.length) document.body.classList.remove('modal-open');
    var o = m._opener;
    if (o && document.body.contains(o) && typeof o.focus === 'function') o.focus();
  }

  function confirmBox(o) {
    $('cf-title').textContent = o.title;
    $('cf-text').textContent = o.text;
    var ok = $('cf-ok');
    ok.textContent = o.okText || 'Confirm';
    ok.className = 'btn ' + (o.danger ? 'danger solid' : 'primary');
    pendingConfirm = o.onOk;
    openModal('modal-confirm', '.modal-foot .btn'); // focus "Cancel" first: the safe choice
  }

  // ----- Add product -----
  function openAdd() {
    $('add-form').reset();
    $('ad-error').textContent = '';
    openModal('modal-add', '#ad-name');
  }

  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var result = Stock.addProduct(state.products, {
      name: $('ad-name').value,
      sku: $('ad-sku').value,
      quantity: $('ad-qty').value,
      threshold: $('ad-thr').value
    });
    if (!result.ok) { $('ad-error').textContent = result.error; return; }
    state.products = result.products;
    commit();
    closeModal($('modal-add'));
    toast('Added ' + result.product.name + (Stock.isLow(result.product) ? ' (already low on stock)' : ''), Stock.isLow(result.product) ? 'warn' : '');
  });

  // ----- Edit product -----
  function openEdit(sku) {
    var p = findProduct(sku);
    if (!p) return;
    editSku = p.sku;
    $('ed-name').value = p.name;
    $('ed-sku').value = p.sku;
    $('ed-qty').value = p.quantity;
    $('ed-thr').value = p.threshold;
    $('ed-error').textContent = '';
    openModal('modal-edit', '#ed-name');
  }

  $('edit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var result = Stock.editProduct(state.products, editSku, {
      name: $('ed-name').value,
      quantity: $('ed-qty').value,
      threshold: $('ed-thr').value
    });
    if (!result.ok) { $('ed-error').textContent = result.error; return; }
    state.products = result.products;
    commit();
    closeModal($('modal-edit'));
    toast('Saved changes to ' + result.product.name);
  });

  // ----- Delete product -----
  function askDelete(sku) {
    var p = findProduct(sku);
    if (!p) return;
    confirmBox({
      title: 'Delete product?',
      text: '"' + p.name + '" will be removed from your stock list. This cannot be undone.',
      okText: 'Delete', danger: true,
      onOk: function () {
        state.products = Stock.removeProduct(state.products, p.sku);
        commit();
        toast('Deleted ' + p.name);
      }
    });
  }

  // ----- Record sale / restock -----
  function updateMoveHint() {
    var p = findProduct($('mv-product').value);
    $('mv-hint').textContent = p ? p.name + ' · SKU ' + p.sku + ' · ' + p.quantity + ' in stock' : '';
  }

  function openMove(type, sku) {
    if (!state.products.length) { toast('Add a product first.', 'warn'); return; }
    move.type = type;
    var sell = type === 'sale';
    $('mv-title').textContent = sell ? 'Record a sale' : 'Restock';
    $('mv-qty-label').textContent = sell ? 'Quantity sold' : 'Quantity received';
    $('mv-submit').textContent = sell ? 'Record sale' : 'Add stock';
    $('mv-error').textContent = '';

    var sel = $('mv-product');
    sel.textContent = '';
    var sorted = state.products.slice().sort(byName);
    sorted.forEach(function (p) {
      var o = el('option', null, p.name + ' (' + p.sku + ')');
      o.value = p.sku;
      sel.appendChild(o);
    });

    var chosen = sku ? findProduct(sku) : null;
    if (!chosen) {
      // no product given: pick something sensible to start with
      chosen = sorted.filter(function (p) { return sell ? p.quantity > 0 : Stock.isLow(p); })[0] || sorted[0];
    }
    sel.value = chosen.sku;
    $('mv-pick').hidden = !!sku;

    $('mv-qty').value = (!sell && Stock.isLow(chosen)) ? Stock.orderQty(chosen) : 1; // restock: suggest the reorder quantity
    updateMoveHint();
    openModal('modal-move', '#mv-qty');
  }

  $('mv-product').addEventListener('change', updateMoveHint);
  $('mv-minus').addEventListener('click', function () {
    $('mv-qty').value = Math.max(1, (parseInt($('mv-qty').value, 10) || 1) - 1);
  });
  $('mv-plus').addEventListener('click', function () {
    $('mv-qty').value = (parseInt($('mv-qty').value, 10) || 0) + 1;
  });

  $('move-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var fn = move.type === 'restock' ? Stock.recordRestock : Stock.recordSale;
    var result = fn(state.products, $('mv-product').value, $('mv-qty').value);
    if (!result.ok) { $('mv-error').textContent = result.error; return; }
    state.products = result.products;
    state.history.unshift(result.movement);
    state.history = state.history.slice(0, MAX_HISTORY);
    commit();
    closeModal($('modal-move'));

    var m = result.movement;
    var p = findProduct(m.sku);
    if (m.type === 'sale') {
      var isLow = Stock.isLow(p);
      toast('Sold ' + m.qty + ' × ' + m.name + '. ' + p.quantity + ' left.' + (isLow ? ' Low stock - time to reorder.' : ''), isLow ? 'warn' : '');
    } else {
      toast('Added ' + m.qty + ' to ' + m.name + '. Now ' + p.quantity + ' in stock.');
    }
  });

  // ---------- demo data / reset ----------
  function setDemo() {
    state = {
      products: [
        { name: 'Aashirvaad Atta 5kg', sku: 'ATTA-5KG', quantity: 3, threshold: 10 },
        { name: 'Tata Salt 1kg', sku: 'SALT-1KG', quantity: 0, threshold: 8 },
        { name: 'Fortune Oil 1L', sku: 'OIL-1L', quantity: 6, threshold: 6 },
        { name: 'Maggi Noodles', sku: 'MAGGI', quantity: 40, threshold: 15 },
        { name: 'Parle-G Biscuit', sku: 'PARLEG', quantity: 55, threshold: 20 },
        { name: 'Sugar 1kg', sku: 'SUGAR-1KG', quantity: 12, threshold: 10 }
      ],
      history: []
    };
    commit();
    toast('Demo data loaded');
  }

  function askDemo() {
    if (!state.products.length) { setDemo(); return; }
    confirmBox({
      title: 'Load demo data?',
      text: 'This replaces your current products and activity with sample data.',
      okText: 'Replace with demo', danger: true, onOk: setDemo
    });
  }

  function askReset() {
    confirmBox({
      title: 'Reset all data?',
      text: 'All products and activity on this device will be deleted. This cannot be undone.',
      okText: 'Delete everything', danger: true,
      onOk: function () { state = emptyState(); commit(); toast('All data cleared'); }
    });
  }

  // ---------- header menu ----------
  function closeMenu() {
    $('menu').hidden = true;
    $('menu-btn').setAttribute('aria-expanded', 'false');
  }

  $('menu-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    var open = $('menu').hidden;
    $('menu').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('menu-demo').addEventListener('click', function () { closeMenu(); askDemo(); });
  $('menu-reset').addEventListener('click', function () { closeMenu(); askReset(); });

  // ---------- wiring: buttons, tabs, search ----------
  $('add-btn').addEventListener('click', openAdd);
  $('ob-add').addEventListener('click', openAdd);
  $('ob-demo').addEventListener('click', askDemo);
  $('ov-sell').addEventListener('click', function () { openMove('sale'); });
  $('ov-restock').addEventListener('click', function () { openMove('restock'); });
  $('ov-viewall').addEventListener('click', function () { ui.lowFilter = 'all'; showTab('low'); });
  $('cf-ok').addEventListener('click', function () {
    var fn = pendingConfirm;
    pendingConfirm = null;
    closeModal($('modal-confirm'));
    if (fn) fn();
  });

  TABS.forEach(function (t) {
    $('tabbtn-' + t).addEventListener('click', function () { showTab(t); });
  });
  $('tabbtn-overview').parentNode.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = TABS.indexOf(ui.tab) + (e.key === 'ArrowRight' ? 1 : -1);
    var next = TABS[(i + TABS.length) % TABS.length];
    showTab(next);
    $('tabbtn-' + next).focus();
  });

  [].forEach.call(document.querySelectorAll('.stat'), function (s) {
    s.addEventListener('click', function () {
      if (s.getAttribute('data-filter')) ui.lowFilter = s.getAttribute('data-filter');
      showTab(s.getAttribute('data-goto'));
    });
  });

  [].forEach.call(document.querySelectorAll('.chip-btn'), function (c) {
    c.addEventListener('click', function () {
      ui.lowFilter = c.getAttribute('data-filter');
      renderLow();
    });
  });

  $('search').addEventListener('input', function () {
    ui.query = $('search').value;
    renderInventory();
  });

  $('copy-btn').addEventListener('click', function () {
    var list = Stock.reorderList(state.products);
    if (!list.length) { toast('Nothing to copy - no items need reordering.', 'warn'); return; }
    copyText(Stock.reorderText(list, todayLabel())).then(
      function () { toast('Reorder list copied'); },
      function () { toast('Copy failed. Please select the list and copy it manually.', 'error'); }
    );
  });
  $('server-retry').addEventListener('click', verifyServer);

  // ---------- global: close things on click-outside / Esc, keep focus inside modals ----------
  document.addEventListener('click', function (e) {
    var close = e.target.closest ? e.target.closest('[data-close]') : null;
    if (close) { closeModal(close.closest('.backdrop')); return; }
    if (e.target.classList && e.target.classList.contains('backdrop')) { closeModal(e.target); return; }
    if (!$('menu').hidden && !$('menu').contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('menu').hidden) { closeMenu(); $('menu-btn').focus(); return; }
      if (modalStack.length) closeModal(modalStack[modalStack.length - 1]);
      return;
    }
    if (e.key === 'Tab' && modalStack.length) {
      var m = modalStack[modalStack.length - 1];
      var items = [].slice.call(m.querySelectorAll('button, input:not([readonly]), select')).filter(function (x) {
        return !x.disabled && !x.closest('[hidden]');
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---------- online / offline badge ----------
  function updateNet() {
    var badge = $('net');
    var online = navigator.onLine;
    badge.textContent = online ? 'Online' : 'Offline mode';
    badge.className = 'net' + (online ? '' : ' offline');
  }
  window.addEventListener('online', function () { updateNet(); if (ui.tab === 'reorder') verifyServer(); });
  window.addEventListener('offline', function () { updateNet(); if (ui.tab === 'reorder') verifyServer(); });

  // ---------- offline support (cache the app files) ----------
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* the app still works without it */ });
  }

  updateNet();
  showTab('overview');
})();
