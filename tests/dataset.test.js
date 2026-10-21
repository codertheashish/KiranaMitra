const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, analyze } = require('../public/dataset.js');

test('parseCSV reads headers, quoted commas and escaped quotes', () => {
  const parsed = parseCSV('Product ID,Category,Note\nP1,"Grocery, staples","says ""fresh"""\nP2,Toys,ok\n');
  assert.deepEqual(parsed.headers, ['Product ID', 'Category', 'Note']);
  assert.equal(parsed.records[0].Category, 'Grocery, staples');
  assert.equal(parsed.records[0].Note, 'says "fresh"');
  assert.equal(parsed.records.length, 2);
});

test('parseCSV handles BOM and CRLF and counts malformed-width rows', () => {
  const parsed = parseCSV('\uFEFFProduct ID,Inventory Level,Units Sold\r\nP1,10,4\r\nP2,5\r\nP3,7,2\r\n');
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.malformedRows, 1);
});

test('parseCSV rejects empty datasets, duplicate headers and unclosed quotes', () => {
  assert.throws(() => parseCSV(''), /header and at least one data row/i);
  assert.throws(() => parseCSV('A,a\n1,2'), /duplicate column names/i);
  assert.throws(() => parseCSV('A,B\n"oops,2'), /unclosed quoted field/i);
});

test('analyze aggregates actual inventory, sales, categories and forecast gaps', () => {
  const parsed = parseCSV('Date,Store ID,Product ID,Category,Inventory Level,Units Sold,Units Ordered,Demand Forecast\n2022-01-01,S1,P1,Groceries,10,4,3,15.2\n2022-01-01,S1,P2,Toys,8,7,5,6\n2022-01-02,S1,P1,Groceries,5,2,4,8\n');
  const result = analyze(parsed);
  assert.equal(result.rows, 3);
  assert.equal(result.distinctProducts, 2);
  assert.equal(result.totalInventory, 23);
  assert.equal(result.totalSold, 13);
  assert.equal(result.totalOrdered, 12);
  assert.equal(result.restockCandidates[0].productId, 'P1');
  assert.equal(result.restockCandidates[0].gap, 6);
  assert.equal(result.categories.find(c => c.name === 'Groceries').rows, 2);
});

test('analyze requires the core inventory columns', () => {
  assert.throws(() => analyze(parseCSV('Product ID,Category\nP1,Grocery')), /Required columns missing/i);
});
