/**
 * DSP-189: three more synthetic cases beside `synthetic-walks.ts`, in neutral invented code (no
 * workplace code), for the varied generic examples the code-walk reference's section 11 asks
 * for: a simple setting, a shared snapshot with readers and a writer, and external code context
 * read at its recorded revision. Only node built-ins and git; the caller removes what it creates.
 *
 * - {@link SETTING_CASE} (TypeScript): an option declared with a default, passed on from the
 *   environment, and used as a loop bound: three places, each with a role of its own.
 * - {@link SNAPSHOT_CASE} (C++): a `SnapshotSlot` that publishes an immutable snapshot through a
 *   `shared_ptr` under a mutex; a feed callback replaces it, a consumer thread copies the pointer
 *   and reads outside the lock. The base copied the whole struct under the lock.
 * - {@link CONTEXT_CASE} (TypeScript, two repositories): the reviewed app changes a call into a
 *   library of the workspace, `count-lib`, declared at 1.0.0 in the To commit's package.json;
 *   the library's HEAD has moved on, so the context is read at the tag. `makeContextRepos`
 *   builds both repositories the way `review-walk-context.test.ts` does.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { SyntheticCase } from './synthetic-walks';

export const SETTING_CASE: SyntheticCase = {
  name: 'setting',
  base: {
    'src/config.ts': ['export interface SyncConfig {', '  readonly endpoint: string;', '}', '', 'export const DEFAULT_CONFIG: SyncConfig = {', "  endpoint: 'https://example.invalid/sync',", '};', ''].join('\n'),
    'src/app.ts': [
      "import { DEFAULT_CONFIG, type SyncConfig } from './config';",
      "import { sync } from './sync';",
      '',
      'export function configFromEnvironment(env: Record<string, string | undefined>): SyncConfig {',
      '  return { ...DEFAULT_CONFIG, endpoint: env.SYNC_ENDPOINT ?? DEFAULT_CONFIG.endpoint };',
      '}',
      '',
      'export async function main(env: Record<string, string | undefined>): Promise<boolean> {',
      '  return sync(configFromEnvironment(env));',
      '}',
      '',
    ].join('\n'),
    'src/sync.ts': [
      "import type { SyncConfig } from './config';",
      '',
      'async function attempt(endpoint: string): Promise<boolean> {',
      "  return endpoint !== '';",
      '}',
      '',
      'export async function sync(config: SyncConfig): Promise<boolean> {',
      '  for (let tries = 0; tries < 3; tries += 1) {',
      '    if (await attempt(config.endpoint)) {',
      '      return true;',
      '    }',
      '  }',
      '  return false;',
      '}',
      '',
    ].join('\n'),
  },
  target: {
    'src/config.ts': [
      'export interface SyncConfig {',
      '  readonly endpoint: string;',
      '  /** How many attempts sync() makes before it gives up. */',
      '  readonly retryLimit: number;',
      '}',
      '',
      'export const DEFAULT_CONFIG: SyncConfig = {',
      "  endpoint: 'https://example.invalid/sync',",
      '  retryLimit: 3,',
      '};',
      '',
    ].join('\n'),
    'src/app.ts': [
      "import { DEFAULT_CONFIG, type SyncConfig } from './config';",
      "import { sync } from './sync';",
      '',
      'export function configFromEnvironment(env: Record<string, string | undefined>): SyncConfig {',
      '  const limit = Number(env.SYNC_RETRY_LIMIT);',
      '  return {',
      '    ...DEFAULT_CONFIG,',
      '    endpoint: env.SYNC_ENDPOINT ?? DEFAULT_CONFIG.endpoint,',
      '    retryLimit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONFIG.retryLimit,',
      '  };',
      '}',
      '',
      'export async function main(env: Record<string, string | undefined>): Promise<boolean> {',
      '  return sync(configFromEnvironment(env));',
      '}',
      '',
    ].join('\n'),
    'src/sync.ts': [
      "import type { SyncConfig } from './config';",
      '',
      'async function attempt(endpoint: string): Promise<boolean> {',
      "  return endpoint !== '';",
      '}',
      '',
      'export async function sync(config: SyncConfig): Promise<boolean> {',
      '  for (let tries = 0; tries < config.retryLimit; tries += 1) {',
      '    if (await attempt(config.endpoint)) {',
      '      return true;',
      '    }',
      '  }',
      '  return false;',
      '}',
      '',
    ].join('\n'),
  },
};

export const SNAPSHOT_CASE: SyntheticCase = {
  name: 'snapshot',
  base: {
    'include/snapshot_slot.h': [
      '#pragma once',
      '#include <mutex>',
      '#include <string>',
      '#include <vector>',
      '',
      'struct DataSnapshot {',
      '  long version = 0;',
      '  std::vector<std::string> rows;',
      '};',
      '',
      'class SnapshotSlot {',
      ' public:',
      '  DataSnapshot get() const {',
      '    std::lock_guard<std::mutex> lock(mutex_);',
      '    return current_;',
      '  }',
      '  void set(const DataSnapshot& next) {',
      '    std::lock_guard<std::mutex> lock(mutex_);',
      '    current_ = next;',
      '  }',
      '',
      ' private:',
      '  mutable std::mutex mutex_;',
      '  DataSnapshot current_;',
      '};',
      '',
    ].join('\n'),
    'src/feed.cpp': [
      '#include "snapshot_slot.h"',
      '',
      'struct Payload {',
      '  long version;',
      '  std::vector<std::string> rows;',
      '};',
      '',
      'void onUpdate(SnapshotSlot& slot, const Payload& payload) {',
      '  DataSnapshot next;',
      '  next.version = payload.version;',
      '  next.rows = payload.rows;',
      '  slot.set(next);',
      '}',
      '',
    ].join('\n'),
    'src/consumer.cpp': [
      '#include "snapshot_slot.h"',
      '#include <atomic>',
      '#include <thread>',
      '',
      'void useRows(const std::vector<std::string>& rows);',
      '',
      'void consume(SnapshotSlot& slot, std::atomic<bool>& stopping) {',
      '  while (!stopping) {',
      '    DataSnapshot snapshot = slot.get();',
      '    useRows(snapshot.rows);',
      '  }',
      '}',
      '',
      'std::thread startConsumer(SnapshotSlot& slot, std::atomic<bool>& stopping) {',
      '  return std::thread([&slot, &stopping] { consume(slot, stopping); });',
      '}',
      '',
    ].join('\n'),
  },
  target: {
    'include/snapshot_slot.h': [
      '#pragma once',
      '#include <memory>',
      '#include <mutex>',
      '#include <string>',
      '#include <vector>',
      '',
      'struct DataSnapshot {',
      '  long version = 0;',
      '  std::vector<std::string> rows;',
      '};',
      '',
      '// Publishes an immutable snapshot: readers keep the one they took while the',
      '// updater installs the next. The mutex protects the pointer, not the rows.',
      'class SnapshotSlot {',
      ' public:',
      '  std::shared_ptr<const DataSnapshot> get() const {',
      '    std::lock_guard<std::mutex> lock(mutex_);',
      '    return current_;',
      '  }',
      '  void set(std::shared_ptr<const DataSnapshot> next) {',
      '    std::lock_guard<std::mutex> lock(mutex_);',
      '    current_ = std::move(next);',
      '  }',
      '',
      ' private:',
      '  mutable std::mutex mutex_;',
      '  std::shared_ptr<const DataSnapshot> current_ = std::make_shared<const DataSnapshot>();',
      '};',
      '',
    ].join('\n'),
    'src/feed.cpp': [
      '#include "snapshot_slot.h"',
      '',
      'struct Payload {',
      '  long version;',
      '  std::vector<std::string> rows;',
      '};',
      '',
      'void onUpdate(SnapshotSlot& slot, const Payload& payload) {',
      '  auto next = std::make_shared<DataSnapshot>();',
      '  next->version = payload.version;',
      '  next->rows = payload.rows;',
      '  slot.set(std::move(next));',
      '}',
      '',
    ].join('\n'),
    'src/consumer.cpp': [
      '#include "snapshot_slot.h"',
      '#include <atomic>',
      '#include <thread>',
      '',
      'void useRows(const std::vector<std::string>& rows);',
      '',
      'void consume(SnapshotSlot& slot, std::atomic<bool>& stopping) {',
      '  while (!stopping) {',
      '    std::shared_ptr<const DataSnapshot> snapshot = slot.get();',
      '    useRows(snapshot->rows);',
      '  }',
      '}',
      '',
      'std::thread startConsumer(SnapshotSlot& slot, std::atomic<bool>& stopping) {',
      '  return std::thread([&slot, &stopping] { consume(slot, stopping); });',
      '}',
      '',
    ].join('\n'),
  },
};

const LIB_FORMAT_V1 = [
  'export interface FormatOptions {',
  '  /** Group thousands with a thin space. Off unless asked. */',
  '  readonly grouping?: boolean;',
  '}',
  '',
  'export function formatCount(count: number, options: FormatOptions = {}): string {',
  "  const digits = String(Math.trunc(count));",
  "  if (options.grouping !== true) {",
  '    return digits;',
  '  }',
  "  return digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '\\u2009');",
  '}',
  '',
].join('\n');

const LIB_FORMAT_HEAD = [
  'export interface FormatOptions {',
  '  /** Group thousands with a thin space. On unless switched off (since 1.1). */',
  '  readonly grouping?: boolean;',
  '}',
  '',
  'export function formatCount(count: number, options: FormatOptions = {}): string {',
  "  const digits = String(Math.trunc(count));",
  "  if (options.grouping === false) {",
  '    return digits;',
  '  }',
  "  return digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '\\u2009');",
  '}',
  '',
].join('\n');

export const CONTEXT_CASE: SyntheticCase = {
  name: 'context',
  base: {
    'package.json': JSON.stringify({ name: 'report-app', dependencies: { 'count-lib': '1.0.0' } }, null, 2),
    'src/report.ts': ["import { formatCount } from 'count-lib';", '', 'export function reportLine(label: string, count: number): string {', '  return `${label}: ${formatCount(count)}`;', '}', ''].join('\n'),
  },
  target: {
    'package.json': JSON.stringify({ name: 'report-app', dependencies: { 'count-lib': '1.0.0' } }, null, 2),
    'src/report.ts': [
      "import { formatCount } from 'count-lib';",
      '',
      'export function reportLine(label: string, count: number): string {',
      '  // Large counts read better grouped; the library groups only when asked.',
      '  return `${label}: ${formatCount(count, { grouping: count >= 10_000 })}`;',
      '}',
      '',
    ].join('\n'),
  },
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

function writeAll(folder: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(folder, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

/**
 * The context case as a workspace: the reviewed app and, beside it, `count-lib` with a `v1.0.0`
 * tag the app's package.json names and a HEAD that has moved on. Returns the app's two commits
 * and the library's two.
 */
export function makeContextRepos(folder: string): { readonly workspace: string; readonly repo: string; readonly base: string; readonly target: string; readonly lib: string; readonly libTagged: string; readonly libHead: string } {
  const workspace = folder;
  const lib = path.join(workspace, 'count-lib');
  fs.mkdirSync(lib, { recursive: true });
  git(lib, 'init', '-q');
  writeAll(lib, { 'package.json': JSON.stringify({ name: 'count-lib', version: '1.0.0' }, null, 2), 'src/format.ts': LIB_FORMAT_V1 });
  git(lib, 'add', '-A');
  git(lib, 'commit', '-q', '-m', 'count-lib 1.0.0');
  const libTagged = git(lib, 'rev-parse', 'HEAD');
  git(lib, 'tag', 'v1.0.0');
  writeAll(lib, { 'package.json': JSON.stringify({ name: 'count-lib', version: '1.1.0' }, null, 2), 'src/format.ts': LIB_FORMAT_HEAD });
  git(lib, 'add', '-A');
  git(lib, 'commit', '-q', '-m', 'count-lib 1.1.0: group by default');
  const libHead = git(lib, 'rev-parse', 'HEAD');
  const repo = path.join(workspace, CONTEXT_CASE.name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  writeAll(repo, CONTEXT_CASE.base);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Base');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeAll(repo, CONTEXT_CASE.target);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Target');
  const target = git(repo, 'rev-parse', 'HEAD');
  return { workspace, repo, base, target, lib, libTagged, libHead };
}
