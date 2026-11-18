'use strict';

/** An amount in öre, written for people: `1 724.90 kr`. */
function formatKronor(ore) {
  const kronor = Math.floor(ore / 100);
  const rest = String(ore % 100).padStart(2, '0');
  return `${String(kronor).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${rest} kr`;
}

module.exports = { formatKronor };
