'use strict';

/** The orders placed in a month, `YYYY-MM`. */
function ordersInMonth(orders, month) {
  return orders.filter((order) => order.placed.startsWith(`${month}-`));
}

module.exports = { ordersInMonth };
