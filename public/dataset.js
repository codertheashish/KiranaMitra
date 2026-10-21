/* CSV parsing and transparent, rule-based retail dataset analysis. Works in browser and Node tests. */
(function (root) {
  'use strict';
  function parseCSV(text) {
    if (typeof text !== 'string') throw new Error('CSV content must be text.');
    var rows = [], row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"' && field.length === 0) quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (quoted) throw new Error('CSV has an unclosed quoted field.');
    if (field.length || row.length) { row.push(field); if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row); }
    if (rows.length < 2) throw new Error('CSV must contain a header and at least one data row.');
    var headers = rows.shift().map(function (h) { return h.trim(); });
    if (headers.some(function (h) { return !h; })) throw new Error('CSV contains an empty column name.');
    var seen = {};
    headers.forEach(function (h) { var k = h.toLowerCase(); if (seen[k]) throw new Error('CSV contains duplicate column names: ' + h); seen[k] = true; });
    var records = [], malformed = 0;
    rows.forEach(function (cells) {
      if (cells.length !== headers.length) { malformed++; return; }
      var item = {};
      headers.forEach(function (h, j) { item[h] = cells[j].trim(); });
      records.push(item);
    });
    if (!records.length) throw new Error('No valid data rows found.');
    var lower = {}; headers.forEach(function (h) { lower[h.toLowerCase()] = h; });
    return { headers: headers, records: records, malformedRows: malformed, lowerHeaders: lower };
  }
  function analyze(parsed) {
    var h = parsed.lowerHeaders || {};
    function col(name) { return h[name.toLowerCase()]; }
    var productCol = col('product id'), categoryCol = col('category'), inventoryCol = col('inventory level'), soldCol = col('units sold'), orderedCol = col('units ordered'), forecastCol = col('demand forecast');
    if (!productCol || !inventoryCol || !soldCol) throw new Error('Required columns missing. Need Product ID, Inventory Level, and Units Sold.');
    function num(record, key) { if (!key || record[key] === '') return null; var n = Number(record[key]); return Number.isFinite(n) ? n : null; }
    var missing = 0, invalidNumeric = 0, totalInventory = 0, totalSold = 0, totalOrdered = 0, totalForecast = 0, forecastCount = 0;
    var products = {}, categories = {}, candidates = [];
    parsed.records.forEach(function (r) {
      var id = r[productCol]; if (!id) { missing++; return; }
      var inv = num(r, inventoryCol), sold = num(r, soldCol), ordered = num(r, orderedCol), forecast = num(r, forecastCol);
      if (inv === null || sold === null) { invalidNumeric++; return; }
      totalInventory += inv; totalSold += sold;
      if (ordered !== null) totalOrdered += ordered;
      if (forecast !== null) { totalForecast += forecast; forecastCount++; }
      products[id] = true;
      var cat = categoryCol && r[categoryCol] ? r[categoryCol] : 'Unspecified';
      if (!categories[cat]) categories[cat] = { name: cat, rows: 0, inventory: 0, sold: 0 };
      categories[cat].rows++; categories[cat].inventory += inv; categories[cat].sold += sold;
      if (forecast !== null && forecast > inv) candidates.push({ productId: id, category: cat, inventory: inv, forecast: forecast, gap: Math.ceil(forecast - inv), date: r[col('date')] || '' });
    });
    candidates.sort(function (a, b) { return b.gap - a.gap; });
    var cats = Object.keys(categories).map(function (k) { return categories[k]; }).sort(function (a, b) { return b.sold - a.sold; });
    return { rows: parsed.records.length, validRows: parsed.records.length - missing - invalidNumeric, malformedRows: parsed.malformedRows || 0, missingProductIds: missing, invalidNumericRows: invalidNumeric, distinctProducts: Object.keys(products).length, totalInventory: totalInventory, totalSold: totalSold, totalOrdered: totalOrdered, averageForecast: forecastCount ? totalForecast / forecastCount : null, categories: cats, restockCandidates: candidates.slice(0, 12), rule: 'For each historical row with numeric Demand Forecast and Inventory Level, gap = ceil(max(0, forecast - inventory)). This is a rule-based comparison, not a trained prediction model.' };
  }
  var api = { parseCSV: parseCSV, analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KiranaDataset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
