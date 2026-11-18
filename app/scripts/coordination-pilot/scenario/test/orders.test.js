'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOrders } = require('../src/orders');
const { ordersInMonth } = require('../src/ledger');
const { formatKronor } = require('../src/format');

test('the shipped orders load, and a month can be picked out', () => {
  const orders = loadOrders();
  assert.equal(orders.length, 8);
  assert.equal(ordersInMonth(orders, '2024-02').length, 3);
});

test('amounts are written in kronor with öre', () => {
  assert.equal(formatKronor(172490), '1 724.90 kr');
});
