// Run:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const Stock = require('../public/stock.js');

function seed() {
  let list = [];
  [
    { name: 'Atta', sku: 'atta-5kg', quantity: 3, threshold: 10 },
    { name: 'Salt', sku: 'SALT', quantity: 0, threshold: 8 },
    { name: 'Oil', sku: 'OIL', quantity: 6, threshold: 6 },
    { name: 'Maggi', sku: 'MAGGI', quantity: 40, threshold: 15 }
  ].forEach((p) => { list = Stock.addProduct(list, p).products; });
  return list;
}

test('addProduct adds and normalises SKU to upper case', () => {
  const r = Stock.addProduct([], { name: '  Atta ', sku: ' atta-5kg ', quantity: '20', threshold: '5' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.products[0], { name: 'Atta', sku: 'ATTA-5KG', quantity: 20, threshold: 5 });
});

test('addProduct rejects duplicate SKU (case-insensitive)', () => {
  const list = seed();
  const r = Stock.addProduct(list, { name: 'Other', sku: 'Salt', quantity: 1, threshold: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /already exists/);
});

test('addProduct rejects bad input', () => {
  const bad = [
    { name: '', sku: 'A', quantity: 1, threshold: 1 },
    { name: 'A', sku: '', quantity: 1, threshold: 1 },
    { name: 'A', sku: 'A', quantity: '', threshold: 1 },
    { name: 'A', sku: 'A', quantity: -1, threshold: 1 },
    { name: 'A', sku: 'A', quantity: 1.5, threshold: 1 },
    { name: 'A', sku: 'A', quantity: 1, threshold: 'abc' },
    { name: 'A', sku: 'A', quantity: 1, threshold: -2 }
  ];
  bad.forEach((input) => assert.equal(Stock.addProduct([], input).ok, false, JSON.stringify(input)));
});

test('recordSale decreases stock and logs the movement', () => {
  const list = seed();
  const r = Stock.recordSale(list, 'MAGGI', '5', '2026-01-01T00:00:00.000Z');
  assert.equal(r.ok, true);
  assert.equal(r.products.find((p) => p.sku === 'MAGGI').quantity, 35);
  assert.deepEqual(r.movement, { type: 'sale', sku: 'MAGGI', name: 'Maggi', qty: 5, time: '2026-01-01T00:00:00.000Z' });
});

test('recordSale does not mutate the original list', () => {
  const list = seed();
  Stock.recordSale(list, 'MAGGI', 5);
  assert.equal(list.find((p) => p.sku === 'MAGGI').quantity, 40);
});

test('recordSale can sell exactly all stock but not more', () => {
  const list = seed();
  const all = Stock.recordSale(list, 'OIL', 6);
  assert.equal(all.ok, true);
  assert.equal(all.products.find((p) => p.sku === 'OIL').quantity, 0);
  const tooMany = Stock.recordSale(list, 'OIL', 7);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /Only 6/);
});

test('recordSale rejects zero, negative, decimal, blank and unknown SKU', () => {
  const list = seed();
  [0, -1, 1.5, '', 'x'].forEach((q) => assert.equal(Stock.recordSale(list, 'OIL', q).ok, false, String(q)));
  assert.equal(Stock.recordSale(list, 'NOPE', 1).ok, false);
});

test('recordSale accepts SKU in any case', () => {
  assert.equal(Stock.recordSale(seed(), 'maggi', 1).ok, true);
});

test('recordRestock increases stock', () => {
  const r = Stock.recordRestock(seed(), 'SALT', 20);
  assert.equal(r.ok, true);
  assert.equal(r.products.find((p) => p.sku === 'SALT').quantity, 20);
  assert.equal(r.movement.type, 'restock');
});

test('status: out / low / ok, and quantity == threshold counts as low', () => {
  const byName = Object.fromEntries(seed().map((p) => [p.name, Stock.stockStatus(p)]));
  assert.deepEqual(byName, { Atta: 'low', Salt: 'out', Oil: 'low', Maggi: 'ok' });
});

test('lowStock returns only low/out items', () => {
  assert.deepEqual(Stock.lowStock(seed()).map((p) => p.sku).sort(), ['ATTA-5KG', 'OIL', 'SALT']);
});

test('reorderList sorts by biggest shortage first and computes order qty', () => {
  const list = Stock.reorderList(seed());
  // shortages: Salt 8-0=8, Atta 10-3=7, Oil 6-6=0
  assert.deepEqual(list.map((i) => i.sku), ['SALT', 'ATTA-5KG', 'OIL']);
  assert.deepEqual(list.map((i) => i.order_qty), [16, 17, 6]);
});

test('order qty is at least 1 even when threshold is 0', () => {
  const list = Stock.addProduct([], { name: 'Gum', sku: 'GUM', quantity: 0, threshold: 0 }).products;
  assert.equal(Stock.reorderList(list)[0].order_qty, 1);
});

test('after a sale drops stock to the threshold, the item enters the reorder list', () => {
  let list = Stock.addProduct([], { name: 'Sugar', sku: 'SUG', quantity: 12, threshold: 10 }).products;
  assert.equal(Stock.reorderList(list).length, 0);
  list = Stock.recordSale(list, 'SUG', 2).products;
  assert.equal(Stock.reorderList(list).length, 1);
});

test('reorderText has numbered lines and a friendly empty message', () => {
  const text = Stock.reorderText(Stock.reorderList(seed()), '1 Jan 2026');
  const lines = text.split('\n');
  assert.equal(lines[0], 'REORDER LIST - 1 Jan 2026');
  assert.equal(lines[1], '1. [SALT] Salt - order 16 (in stock 0, minimum 8)');
  assert.match(Stock.reorderText([]), /Nothing to reorder/);
});

test('cleanProducts drops corrupt entries and duplicate SKUs', () => {
  const cleaned = Stock.cleanProducts([
    { name: 'Ok', sku: 'a', quantity: 1, threshold: 1 },
    { name: 'Dup', sku: 'A', quantity: 1, threshold: 1 },
    { name: '', sku: 'b', quantity: 1, threshold: 1 },
    { name: 'Neg', sku: 'c', quantity: -5, threshold: 1 },
    null,
    'junk'
  ]);
  assert.deepEqual(cleaned, [{ name: 'Ok', sku: 'A', quantity: 1, threshold: 1 }]);
  assert.deepEqual(Stock.cleanProducts('not an array'), []);
});

test('removeProduct deletes by SKU', () => {
  assert.equal(Stock.removeProduct(seed(), 'salt').length, 3);
});

// ---- added for the KiranaMitra dashboard ----

test('totals are calculated from real data (low includes out of stock)', () => {
  // seed: Atta 3/10 low, Salt 0/8 out, Oil 6/6 low, Maggi 40/15 healthy
  assert.deepEqual(Stock.totals(seed()), { products: 4, low: 3, out: 1, lowOnly: 2, healthy: 1, units: 49 });
  assert.deepEqual(Stock.totals([]), { products: 0, low: 0, out: 0, lowOnly: 0, healthy: 0, units: 0 });
});

test('totals match the reorder list size', () => {
  const list = seed();
  assert.equal(Stock.totals(list).low, Stock.reorderList(list).length);
});

test('totals change after a sale', () => {
  const after = Stock.recordSale(seed(), 'MAGGI', 30).products; // 40 -> 10, below threshold 15
  const t = Stock.totals(after);
  assert.equal(t.low, 4);
  assert.equal(t.units, 19);
});

test('editProduct updates name, quantity and threshold but keeps the SKU', () => {
  const r = Stock.editProduct(seed(), 'maggi', { name: ' Maggi 2-Min ', quantity: '12', threshold: '20' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.product, { name: 'Maggi 2-Min', sku: 'MAGGI', quantity: 12, threshold: 20 });
  assert.equal(r.products.length, 4);
});

test('editProduct does not mutate the original and rejects bad input', () => {
  const list = seed();
  Stock.editProduct(list, 'MAGGI', { name: 'X', quantity: 1, threshold: 1 });
  assert.equal(list.find((p) => p.sku === 'MAGGI').name, 'Maggi');
  [
    { name: '', quantity: 1, threshold: 1 },
    { name: 'A', quantity: -1, threshold: 1 },
    { name: 'A', quantity: 1.5, threshold: 1 },
    { name: 'A', quantity: 1, threshold: '' }
  ].forEach((f) => assert.equal(Stock.editProduct(list, 'MAGGI', f).ok, false, JSON.stringify(f)));
  assert.equal(Stock.editProduct(list, 'NOPE', { name: 'A', quantity: 1, threshold: 1 }).ok, false);
});

test('editing quantity above threshold removes the item from the reorder list', () => {
  const r = Stock.editProduct(seed(), 'SALT', { name: 'Salt', quantity: 50, threshold: 8 });
  assert.equal(Stock.reorderList(r.products).some((i) => i.sku === 'SALT'), false);
});

test('searchProducts matches name or SKU, case-insensitively', () => {
  const list = seed();
  assert.deepEqual(Stock.searchProducts(list, 'mag').map((p) => p.sku), ['MAGGI']);
  assert.deepEqual(Stock.searchProducts(list, 'ATTA-5').map((p) => p.sku), ['ATTA-5KG']);
  assert.equal(Stock.searchProducts(list, '  ').length, 4);
  assert.equal(Stock.searchProducts(list, null).length, 4);
  assert.equal(Stock.searchProducts(list, 'zzz').length, 0);
});
