/**
 * Seed a kit for the `pair-review` scenario (DSP-150): a user-data folder whose only
 * project is a workspace with two Git repositories and a folder without Git.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/seed-pair-kit.mjs <kit-folder> [--agent claude] [--model <id>] [--history <record.json>] [--fixture analysis|marks]
 *
 * `--fixture analysis` (DSP-152) makes the workspace the analysis fixture instead: one
 * repository whose change depends on an unchanged definition in another file, with a
 * working copy that differs from both commits (`tests/support/analysis-fixture.ts`).
 * `--fixture marks` makes it one repository whose change holds the kinds of change the
 * diff's marks must tell apart (`tests/support/marks-fixture.ts`). `--fixture flow` makes it
 * the review flow's repository (`tests/support/flow-fixture.ts`): a call path, a document
 * with independent changes and a file list long enough to scroll. `--clone <repository>`
 * adds a clone of another repository beside it, made with `git clone --no-local`, which only
 * reads the source; its working copy and its `.git` are not changed.
 *
 * Writes `<kit>/userData`, `<kit>/workspace` and `<kit>/kit.json`. A fixture's walk
 * definition is recorded as opened before, so the review offers it among the pair's walks.
 * Nothing outside the kit folder is touched.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { pairKeyOf } from '../src/host/review-pairs';
import { ProjectStore } from '../src/main/project-store';
import { execFileSync } from 'node:child_process';

import { makeAnalysisFixture } from '../tests/support/analysis-fixture';
import { makeFlowFixture } from '../tests/support/flow-fixture';
import { makeMarksFixture } from '../tests/support/marks-fixture';
import { makePairFixture } from '../tests/support/pair-fixture';

const kitArgument = process.argv[2];
if (kitArgument === undefined || kitArgument.trim() === '') {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/seed-pair-kit.mjs <kit-folder>');
  process.exit(2);
}
const KIT = path.resolve(kitArgument);
// DSP-152: the agent the kit's person chose (Cursor when absent) and the model chosen for
// it, as the chat's own choices would have stored them.
/** @param {string} name */
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at > 2 ? (process.argv[at + 1] ?? null) : null;
};
const AGENT = option('--agent') ?? 'cursor';
const MODEL = option('--model');
// DSP-152: a review record copied from a real profile, whose jobs become the history of the
// kit's own pair (the app repository's two commits), as the same review opened again.
const HISTORY = option('--history');
const FIXTURE = option('--fixture') ?? 'pair';
if (FIXTURE !== 'pair' && FIXTURE !== 'analysis' && FIXTURE !== 'marks' && FIXTURE !== 'flow') {
  console.error('--fixture is pair, analysis, marks or flow');
  process.exit(2);
}
const CLONE = option('--clone');
if (AGENT !== 'cursor' && AGENT !== 'claude') {
  console.error('--agent is cursor or claude');
  process.exit(2);
}
const USERDATA = path.join(KIT, 'userData');
if (fs.existsSync(USERDATA)) {
  console.error(`${USERDATA} already exists; seed a fresh kit folder.`);
  process.exit(2);
}
fs.mkdirSync(USERDATA, { recursive: true });
const workspace = path.join(KIT, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const fixture =
  FIXTURE === 'analysis'
    ? makeAnalysisFixture(workspace)
    : FIXTURE === 'marks'
      ? makeMarksFixture(workspace)
      : FIXTURE === 'flow'
        ? makeFlowFixture(workspace)
        : makePairFixture(workspace);
let cloned = null;
if (CLONE !== null) {
  cloned = path.join(workspace, path.basename(path.resolve(CLONE)));
  execFileSync('git', ['clone', '--no-local', '--quiet', path.resolve(CLONE), cloned], { stdio: 'inherit' });
}

// The kit's person chose an agent (Cursor unless told otherwise); nothing in the
// scenario reaches a provider, and the presentation adapter answers in its place.
fs.writeFileSync(
  path.join(USERDATA, 'dspatch-agent-choice.json'),
  `${JSON.stringify({ formatVersion: 1, agent: AGENT, chosenAtUtc: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
if (MODEL !== null) {
  fs.writeFileSync(
    path.join(USERDATA, 'dspatch-model-choice.json'),
    `${JSON.stringify({ formatVersion: 1, models: { [AGENT]: MODEL } }, null, 2)}\n`,
    'utf8',
  );
}
const projects = new ProjectStore(path.join(USERDATA, 'dspatch-projects.json'));
const outcome = projects.openFolder(workspace, new Date().toISOString());
if (outcome.problem !== null) {
  throw new Error(outcome.problem);
}
if (HISTORY !== null && 'app' in fixture) {
  const copied = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
  const pair = { repository: fixture.app, base: fixture.appBase, target: fixture.appTarget };
  const pairs = path.join(USERDATA, 'reviews', 'pairs');
  fs.mkdirSync(pairs, { recursive: true });
  fs.writeFileSync(path.join(pairs, `${pairKeyOf(pair)}.json`), `${JSON.stringify({ ...copied, pair, position: null }, null, 2)}\n`, 'utf8');
}
// The fixture's hand-written walk was opened before, as a walk opened from the chat would
// have been: the review offers it among the pair's walks without any file chooser (Niclas's
// trial feedback of 29 October 2026 took the chooser out of the review flow).
if ('walkDefinition' in fixture && 'app' in fixture) {
  const reviews = path.join(USERDATA, 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  const repositories = { kit: { repository: fixture.app, definitionPath: fixture.walkDefinition, openedAt: new Date().toISOString() } };
  fs.writeFileSync(path.join(reviews, 'recent.json'), `${JSON.stringify({ version: 1, repositories }, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(path.join(KIT, 'kit.json'), `${JSON.stringify({ ...fixture, cloned }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ kit: KIT, workspace, walk: 'walkDefinition' in fixture ? fixture.walkDefinition : null }));
