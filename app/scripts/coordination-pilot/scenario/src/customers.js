'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The customer with this id, or `null`. */
function customerById(id) {
  const customers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'customers.json'), 'utf8'));
  return customers.find((customer) => customer.id === id) ?? null;
}

module.exports = { customerById };
