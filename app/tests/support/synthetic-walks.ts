/**
 * DSP-185: synthetic cases for walk structure and explanation quality, in neutral invented code
 * (no workplace code). Only node built-ins and git; the caller removes what it creates.
 *
 * - {@link WORKER_CASE}: a caller that calls two meaningful new functions in sequence, both
 *   added further down the same file, close enough that the old pane rule merged them; and a
 *   second file whose change is another walk, for a link between walks.
 * - {@link WORK_QUEUE_CASE}: a producer/worker relation with shared ownership: a queue with a
 *   mutex-protected map of shared job slots, an `acquire` that looks up or creates a slot under
 *   a scoped lock, sets a flag and notifies, and a worker thread whose loop waits on the
 *   condition variable and processes slots; plus a caller. Used to build the exact explanation
 *   prompts for an independent qualitative check (`scripts/explain-prompt.mjs`).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface SyntheticCase {
  readonly name: string;
  readonly base: Readonly<Record<string, string>>;
  readonly target: Readonly<Record<string, string>>;
}

export const WORKER_CASE: SyntheticCase = {
  name: 'worker',
  base: {
    'src/worker.js': ['export function run(items, n) {', '  return n;', '}', '', 'const state = {};', 'export const spare1 = 1;', 'export const spare2 = 2;', ''].join('\n'),
    'src/format.js': ['export function formatPair(a, b) {', "  return a + '/' + b;", '}', ''].join('\n'),
  },
  // Lines 2–3 call two new functions, added at 8–11 and 14–18 with only a few unchanged lines
  // between: before DSP-185 the three places shared one pane that scrolled between them.
  target: {
    'src/worker.js': [
      'export function run(items, n) {',
      '  startWorker();',
      '  subscribeToPairs(items, n);',
      '  return n;',
      '}',
      '',
      'const state = {};',
      'function startWorker() {',
      '  state.worker = { running: true, connected: false };',
      '  state.worker.queue = [];',
      '}',
      'export const spare1 = 1;',
      'export const spare2 = 2;',
      'function subscribeToPairs(items, n) {',
      '  const pairs = items.slice(0, n).map((item, index) => [index, item]);',
      '  state.worker.queue.push(...pairs);',
      '  return pairs.length;',
      '}',
      '',
    ].join('\n'),
    'src/format.js': ['export function formatPair(a, b) {', "  return a + ' / ' + b;", '}', ''].join('\n'),
  },
};

export const WORK_QUEUE_CASE: SyntheticCase = {
  name: 'work-queue',
  base: {
    'src/work_queue.h': [
      '#pragma once',
      '#include <map>',
      '#include <memory>',
      '#include <string>',
      '',
      'struct Job {',
      '  std::string key;',
      '};',
      '',
      'class WorkQueue {',
      ' public:',
      '  std::shared_ptr<Job> find(const std::string& key);',
      '',
      ' private:',
      '  std::map<std::string, std::shared_ptr<Job>> slots_;',
      '};',
      '',
    ].join('\n'),
    'src/work_queue.cpp': [
      '#include "work_queue.h"',
      '',
      'std::shared_ptr<Job> WorkQueue::find(const std::string& key) {',
      '  auto it = slots_.find(key);',
      '  return it == slots_.end() ? nullptr : it->second;',
      '}',
      '',
    ].join('\n'),
    'src/submit.cpp': ['#include "work_queue.h"', '', 'void submit(WorkQueue& queue, const std::string& key) {', '  queue.find(key);', '}', ''].join('\n'),
  },
  target: {
    'src/work_queue.h': [
      '#pragma once',
      '#include <condition_variable>',
      '#include <map>',
      '#include <memory>',
      '#include <mutex>',
      '#include <string>',
      '#include <thread>',
      '',
      'struct Job {',
      '  std::string key;',
      '  bool pending = false;',
      '  int runs = 0;',
      '};',
      '',
      'class WorkQueue {',
      ' public:',
      '  WorkQueue();',
      '  ~WorkQueue();',
      '  std::shared_ptr<Job> acquire(const std::string& key);',
      '',
      ' private:',
      '  void workerLoop();',
      '',
      '  std::mutex mutex_;',
      '  std::condition_variable cv_;',
      '  bool stopping_ = false;',
      '  std::map<std::string, std::shared_ptr<Job>> slots_;',
      '  std::thread worker_;',
      '};',
      '',
    ].join('\n'),
    'src/work_queue.cpp': [
      '#include "work_queue.h"',
      '',
      'WorkQueue::WorkQueue() : worker_([this] { workerLoop(); }) {}',
      '',
      'WorkQueue::~WorkQueue() {',
      '  {',
      '    std::lock_guard<std::mutex> lock(mutex_);',
      '    stopping_ = true;',
      '  }',
      '  cv_.notify_all();',
      '  worker_.join();',
      '}',
      '',
      'std::shared_ptr<Job> WorkQueue::acquire(const std::string& key) {',
      '  std::lock_guard<std::mutex> lock(mutex_);',
      '  auto& slot = slots_[key];',
      '  if (!slot) {',
      '    slot = std::make_shared<Job>();',
      '    slot->key = key;',
      '  }',
      '  slot->pending = true;',
      '  cv_.notify_all();',
      '  return slot;',
      '}',
      '',
      'void WorkQueue::workerLoop() {',
      '  std::unique_lock<std::mutex> lock(mutex_);',
      '  while (!stopping_) {',
      '    cv_.wait(lock);',
      '    for (auto& [key, job] : slots_) {',
      '      if (job->pending) {',
      '        job->pending = false;',
      '        job->runs += 1;',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/submit.cpp': [
      '#include "work_queue.h"',
      '',
      'std::shared_ptr<Job> submit(WorkQueue& queue, const std::string& key) {',
      '  auto job = queue.acquire(key);',
      '  return job;',
      '}',
      '',
    ].join('\n'),
  },
};

/**
 * The work-queue case's walk, one place per step, as a definition (`dspatch-review/2`): the
 * caller, then `acquire`, then the worker loop that receives what `acquire` hands over.
 */
export function workQueueWalk(repository: string, base: string, target: string): Record<string, unknown> {
  const both = (text: string): { sv: string; en: string } => ({ sv: text, en: text });
  const step = (id: string, title: string, summary: string, body: string, place: { path: string; start: number; end: number; label: string; from?: { path: string; start: number; end: number; label: string } }): Record<string, unknown> => ({
    id,
    title: both(title),
    summary: both(summary),
    body: both(body),
    places: [
      {
        id: 'P1',
        label: both(place.label),
        focus: { path: place.path, side: 'target', start: place.start, end: place.end, role: 'walk' },
        ...(place.from === undefined ? {} : { from: { label: both(place.from.label), path: place.from.path, side: 'target', start: place.from.start, end: place.from.end } }),
      },
    ],
  });
  return {
    format: 'dspatch-review/2',
    title: both('Work queue walk'),
    repository,
    base,
    target,
    teachingMode: 'Generated',
    provenance: both('Written by tests/support/synthetic-walks.ts: a synthetic case, not a generated walk.'),
    overviewSummary: both('Submitting a key now acquires a job slot that a worker thread processes.'),
    overview: both('Submitting a key now acquires a job slot that a worker thread processes.'),
    walks: [
      {
        id: 'W1',
        kind: 'walk',
        title: both('What happens when a key is submitted'),
        purpose: both('From the caller to the worker that does the job.'),
        question: both('What does submitting a key do, and when is the work done?'),
        steps: [
          step('W1.1', 'The caller acquires a job', 'submit() now asks the queue for the job of a key.', 'submit() calls acquire() and returns the job it gets.', { path: 'src/submit.cpp', start: 3, end: 6, label: 'submit()' }),
          step('W1.2', 'acquire() finds or creates the slot and wakes the worker', 'The slot of the key, marked pending, and the worker notified.', 'acquire() looks up the slot of the key, creates it when missing, marks it pending and notifies the worker.', {
            path: 'src/work_queue.cpp',
            start: 14,
            end: 24,
            label: 'WorkQueue::acquire()',
            from: { path: 'src/submit.cpp', start: 4, end: 4, label: 'The call in submit()' },
          }),
          step('W1.3', 'The worker loop processes pending slots', 'The worker waits for a notification and processes what is pending.', 'workerLoop() waits on the condition variable and processes every pending slot.', {
            path: 'src/work_queue.cpp',
            start: 26,
            end: 37,
            label: 'WorkQueue::workerLoop()',
          }),
        ],
      },
    ],
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A repository with the case's base and target as two commits, under `folder`. */
export function makeSyntheticRepo(folder: string, which: SyntheticCase): { readonly repo: string; readonly base: string; readonly target: string } {
  const repo = path.join(folder, which.name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'core.autocrlf', 'false');
  const commit = (files: Readonly<Record<string, string>>, message: string): string => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
      fs.writeFileSync(path.join(repo, name), text);
    }
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', message);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const base = commit(which.base, 'base commit');
  const target = commit(which.target, 'target commit');
  return { repo, base, target };
}
