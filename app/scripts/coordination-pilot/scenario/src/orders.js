'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The order records, as stored. */
function loadOrders() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'orders.json'), 'utf8'));
}

module.exports = { loadOrders };
