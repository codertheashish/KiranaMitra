/*
 * KiranaMitra - stock.js - ALL the stock rules live here (no DOM, no network).
 * Works in the browser (window.Stock) and in Node (require) so it can be tested.
 * Functions never change the array you pass in; they return a new one.
 *
 * Rules (keep in sync with api/reorder.py):
 *   LOW      -> quantity <= threshold
 *   OUT      -> quantity == 0
 *   ORDER    -> max(threshold * 2 - quantity, 1)   (refill to double the minimum)
 *   SORT     -> biggest shortage (threshold - quantity) first, then name, then SKU
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_NUMBER = 1000000;

  function fail(error) { return { ok: false, error: error }; }

  // "12" -> 12, "" -> NaN, "1.5" -> NaN, "abc" -> NaN
  function toInt(value) {
    if (typeof value === 'string' && value.trim() === '') return NaN;
    if (value === null || value === undefined || typeof value === 'boolean') return NaN;
    var n = Number(value);
    return Number.isInteger(n) ? n : NaN;
  }

  function normalizeSku(sku) {
    return String(sku === null || sku === undefined ? '' : sku).trim().toUpperCase();
  }

  function validCount(n) { return Number.isInteger(n) && n >= 0 && n <= MAX_NUMBER; }

  function findIndex(products, sku) {
    var key = normalizeSku(sku);
    for (var i = 0; i < products.length; i++) {
      if (products[i].sku === key) return i;
    }
    return -1;
  }

  // 1. Add a product -------------------------------------------------------
  function addProduct(products, input) {
    var name = String(input && input.name !== undefined && input.name !== null ? input.name : '').trim();
    var sku = normalizeSku(input && input.sku);
    var quantity = toInt(input && input.quantity);
    var threshold = toInt(input && input.threshold);

    if (!name) return fail('Product name is required.');
    if (!sku) return fail('SKU is required.');
    if (!validCount(quantity)) return fail('Quantity must be a whole number from 0 to ' + MAX_NUMBER + '.');
    if (!validCount(threshold)) return fail('Reorder threshold must be a whole number from 0 to ' + MAX_NUMBER + '.');
    if (findIndex(products, sku) !== -1) return fail('SKU "' + sku + '" already exists.');

    var product = { name: name, sku: sku, quantity: quantity, threshold: threshold };
    return { ok: true, products: products.concat([product]), product: product };
  }

  // 2. Record a sale (stock goes DOWN) ------------------------------------
  function recordSale(products, sku, qty, nowIso) {
    var n = toInt(qty);
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) return fail('Sale quantity must be a whole number of 1 or more.');
    var i = findIndex(products, sku);
    if (i === -1) return fail('Please choose a product.');
    var p = products[i];
    if (n > p.quantity) return fail('Only ' + p.quantity + ' of "' + p.name + '" in stock. Cannot sell ' + n + '.');

    var updated = { name: p.name, sku: p.sku, quantity: p.quantity - n, threshold: p.threshold };
    var next = products.slice();
    next[i] = updated;
    return {
      ok: true,
      products: next,
      movement: { type: 'sale', sku: p.sku, name: p.name, qty: n, time: nowIso || new Date().toISOString() }
    };
  }

  // Extra: restock (stock goes UP) - needed so the demo loop is complete -----
  function recordRestock(products, sku, qty, nowIso) {
    var n = toInt(qty);
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) return fail('Restock quantity must be a whole number of 1 or more.');
    var i = findIndex(products, sku);
    if (i === -1) return fail('Please choose a product.');
    var p = products[i];
    if (p.quantity + n > MAX_NUMBER) return fail('Stock cannot go above ' + MAX_NUMBER + '.');

    var updated = { name: p.name, sku: p.sku, quantity: p.quantity + n, threshold: p.threshold };
    var next = products.slice();
    next[i] = updated;
    return {
      ok: true,
      products: next,
      movement: { type: 'restock', sku: p.sku, name: p.name, qty: n, time: nowIso || new Date().toISOString() }
    };
  }

  function removeProduct(products, sku) {
    var key = normalizeSku(sku);
    return products.filter(function (p) { return p.sku !== key; });
  }

  // Edit name / quantity / threshold. The SKU is the product's identity, so it cannot change.
  function editProduct(products, sku, fields) {
    var i = findIndex(products, sku);
    if (i === -1) return fail('Product not found.');
    var name = String(fields && fields.name !== undefined && fields.name !== null ? fields.name : '').trim();
    var quantity = toInt(fields && fields.quantity);
    var threshold = toInt(fields && fields.threshold);

    if (!name) return fail('Product name is required.');
    if (!validCount(quantity)) return fail('Quantity must be a whole number from 0 to ' + MAX_NUMBER + '.');
    if (!validCount(threshold)) return fail('Reorder threshold must be a whole number from 0 to ' + MAX_NUMBER + '.');

    var updated = { name: name, sku: products[i].sku, quantity: quantity, threshold: threshold };
    var next = products.slice();
    next[i] = updated;
    return { ok: true, products: next, product: updated };
  }

  // Search by name or SKU (case-insensitive). Empty query returns everything.
  function searchProducts(products, query) {
    var q = String(query === null || query === undefined ? '' : query).trim().toLowerCase();
    if (!q) return products.slice();
    return products.filter(function (p) {
      return p.name.toLowerCase().indexOf(q) !== -1 || p.sku.toLowerCase().indexOf(q) !== -1;
    });
  }

  // Dashboard numbers, always calculated from the real product list.
  //   low     = every product at or below its threshold (this INCLUDES out-of-stock items,
  //             exactly like the Low Stock list and the reorder list)
  //   out     = quantity is 0 (a subset of low)
  //   lowOnly = low but not out; healthy = everything above its threshold
  function totals(products) {
    var t = { products: products.length, low: 0, out: 0, lowOnly: 0, healthy: 0, units: 0 };
    products.forEach(function (p) {
      t.units += p.quantity;
      var s = stockStatus(p);
      if (s === 'out') { t.out++; t.low++; }
      else if (s === 'low') { t.lowOnly++; t.low++; }
      else t.healthy++;
    });
    return t;
  }

  // 3. Low-stock alerts ----------------------------------------------------
  function stockStatus(p) {
    if (p.quantity === 0) return 'out';
    if (p.quantity <= p.threshold) return 'low';
    return 'ok';
  }

  function isLow(p) { return p.quantity <= p.threshold; }

  function lowStock(products) {
    return products.filter(isLow).sort(compareByShortage);
  }

  // 4. Sorted reorder list -------------------------------------------------
  function orderQty(p) { return Math.max(p.threshold * 2 - p.quantity, 1); }

  function compareByShortage(a, b) {
    var sa = a.threshold - a.quantity;
    var sb = b.threshold - b.quantity;
    if (sa !== sb) return sb - sa; // bigger shortage first
    var na = a.name.toLowerCase();
    var nb = b.name.toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  }

  function reorderList(products) {
    return products.filter(isLow).sort(compareByShortage).map(function (p) {
      return { sku: p.sku, name: p.name, quantity: p.quantity, threshold: p.threshold, order_qty: orderQty(p) };
    });
  }

  function reorderText(list, dateLabel) {
    var lines = ['REORDER LIST' + (dateLabel ? ' - ' + dateLabel : '')];
    if (!list.length) {
      lines.push('Nothing to reorder. All stock is above the minimum.');
    } else {
      list.forEach(function (it, i) {
        lines.push((i + 1) + '. [' + it.sku + '] ' + it.name + ' - order ' + it.order_qty +
          ' (in stock ' + it.quantity + ', minimum ' + it.threshold + ')');
      });
    }
    return lines.join('\n');
  }

  // Used when loading from localStorage: drop anything that is not a valid product.
  function cleanProducts(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.forEach(function (p) {
      if (!p || typeof p.name !== 'string' || !p.name.trim()) return;
      var sku = normalizeSku(p.sku);
      if (!sku || !validCount(p.quantity) || !validCount(p.threshold)) return;
      if (out.some(function (q) { return q.sku === sku; })) return;
      out.push({ name: p.name.trim(), sku: sku, quantity: p.quantity, threshold: p.threshold });
    });
    return out;
  }

  return {
    addProduct: addProduct,
    recordSale: recordSale,
    recordRestock: recordRestock,
    removeProduct: removeProduct,
    editProduct: editProduct,
    searchProducts: searchProducts,
    totals: totals,
    stockStatus: stockStatus,
    isLow: isLow,
    lowStock: lowStock,
    orderQty: orderQty,
    reorderList: reorderList,
    reorderText: reorderText,
    cleanProducts: cleanProducts,
    normalizeSku: normalizeSku
  };
});
