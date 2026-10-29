/**
 * A repository for the review flow after Niclas's first real trial (29 October 2026).
 *
 * `shop` has two commits whose change holds what the flow must show:
 *
 * - A code change with a real call path: the button in `src/app/checkout-button.ts` calls
 *   `checkout()` in `src/cart.ts`, which now calls `discountFor()` in `src/pricing.ts`, a
 *   file the change does not touch. A code walk can follow it from the press.
 * - A documentation change, `docs/guide.md`, with two independent changes far apart, each
 *   a reading of its own.
 * - A file with a long path, and enough small data files that *Files changed* scrolls;
 *   one of them holds a value the simulated reviewer reports as a problem (`added2`).
 *
 * The content is invented for the check. Only node built-ins and git; nothing here touches
 * DSpatch's own data.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FlowFixture {
  /** The workspace folder: `shop/`. */
  readonly workspace: string;
  readonly shop: string;
  readonly base: string;
  readonly target: string;
  /** The file with the long path. */
  readonly longPath: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(folder: string, file: string, text: string): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const lines = (...all: string[]): string => `${all.join('\n')}\n`;

const PRICING = lines(
  "import type { Item } from './item';",
  '',
  '/** The price of the items, before any discount. */',
  'export function priceOf(items: readonly Item[]): number {',
  '  return items.reduce((sum, item) => sum + item.price * item.count, 0);',
  '}',
  '',
  '/** How much a discount code takes off a total; nothing for an unknown code. */',
  'export function discountFor(code: string | null, total: number): number {',
  "  if (code === 'SPRING') {",
  '    return Math.round(total * 0.1);',
  '  }',
  '  return 0;',
  '}',
);

const ITEM = lines('export interface Item {', '  readonly name: string;', '  readonly price: number;', '  readonly count: number;', '}');

const CART_BASE = lines(
  "import type { Item } from './item';",
  "import { priceOf } from './pricing';",
  '',
  '/** What the customer pays for the items in the cart. */',
  'export function checkout(items: readonly Item[]): number {',
  '  return priceOf(items);',
  '}',
);

const CART_TARGET = lines(
  "import type { Item } from './item';",
  "import { discountFor, priceOf } from './pricing';",
  '',
  '/** What the customer pays for the items in the cart, after a discount code. */',
  'export function checkout(items: readonly Item[], code: string | null): number {',
  '  const total = priceOf(items);',
  '  return total - discountFor(code, total);',
  '}',
);

const BUTTON_BASE = lines(
  "import { checkout } from '../cart';",
  "import type { Item } from '../item';",
  '',
  'export function onPayPressed(items: readonly Item[], show: (amount: number) => void): void {',
  '  show(checkout(items));',
  '}',
);

const BUTTON_TARGET = lines(
  "import { checkout } from '../cart';",
  "import type { Item } from '../item';",
  '',
  'export function onPayPressed(items: readonly Item[], code: string | null, show: (amount: number) => void): void {',
  '  show(checkout(items, code));',
  '}',
);

const filler = (from: number, count: number): string[] => Array.from({ length: count }, (_, index) => `Line ${String(from + index)} of the guide stays as it is.`);

const GUIDE_BASE = lines(
  '# Paying',
  '',
  'A customer pays the price of the items in the cart.',
  '',
  ...filler(5, 30),
  '',
  '## Refunds',
  '',
  'A refund is the price that was paid, sent back within five working days.',
);

const GUIDE_TARGET = lines(
  '# Paying',
  '',
  'A customer pays the price of the items in the cart, less the discount of a valid code. The only code today is SPRING, which takes ten percent off; any other code takes nothing off and is not reported as an error.',
  '',
  ...filler(5, 30),
  '',
  '## Refunds',
  '',
  'A refund is the amount that was paid after any discount, sent back within ten working days.',
);

const LONG_PATH = 'src/features/portable-instruments/proxies/PortableInstrumentProxyRegistryConfigurationDefaults.ts';

export function makeFlowFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-flow-'))): FlowFixture {
  const shop = path.join(workspace, 'shop');
  fs.mkdirSync(shop, { recursive: true });
  git(shop, 'init', '-q');
  git(shop, 'config', 'user.email', 'test@example.invalid');
  git(shop, 'config', 'user.name', 'Test Author');
  git(shop, 'config', 'core.autocrlf', 'false');
  write(shop, 'src/item.ts', ITEM);
  write(shop, 'src/pricing.ts', PRICING);
  write(shop, 'src/cart.ts', CART_BASE);
  write(shop, 'src/app/checkout-button.ts', BUTTON_BASE);
  write(shop, 'docs/guide.md', GUIDE_BASE);
  for (let index = 1; index <= 26; index += 1) {
    write(shop, `data/item-${String(index).padStart(2, '0')}.json`, `${JSON.stringify({ id: index, price: index * 10 }, null, 2)}\n`);
  }
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'A cart without discounts');
  const base = git(shop, 'rev-parse', 'HEAD');
  write(shop, 'src/cart.ts', CART_TARGET);
  write(shop, 'src/app/checkout-button.ts', BUTTON_TARGET);
  write(shop, 'docs/guide.md', GUIDE_TARGET);
  for (let index = 1; index <= 26; index += 1) {
    // item-02 gains a value the simulated reviewer reports as a problem (`added2`).
    const after = index === 2 ? { id: index, price: index * 10 + 5, note: 'added2' } : { id: index, price: index * 10 + 5 };
    write(shop, `data/item-${String(index).padStart(2, '0')}.json`, `${JSON.stringify(after, null, 2)}\n`);
  }
  write(shop, LONG_PATH, lines('/** The registry the proxies start from. */', 'export const DEFAULT_PROXY_REGISTRY: readonly string[] = [];'));
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'Discount codes at checkout');
  const target = git(shop, 'rev-parse', 'HEAD');
  return { workspace, shop, base, target, longPath: LONG_PATH };
}
