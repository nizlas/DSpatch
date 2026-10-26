/**
 * Seed the kit the `review-window` and `review-direct` scenarios run over (DSP-126).
 *
 * Two real git repositories from `tests/support/review-fixture.ts` - two commits each,
 * and a working tree that says something else - plus a fresh user-data folder whose
 * only DSpatch file is the Recent list naming them. No provider is called and nothing
 * of your own DSpatch data is read or written. What it writes, into an empty kit folder:
 *
 *     <kit>\userData\dspatch-projects.json    Recent = P1, P2 (no conversations)
 *     <kit>\p1\repo                           P1: the fixture repository
 *     <kit>\p1\walk.review.json               a three-step walk over P1, the definition chosen
 *     <kit>\p2\other                          P2: a second fixture repository (other commits), never reviewed
 *     <kit>\seed-summary.json                 the paths and revisions written
 *
 * Run from `app/` (the kit folder must not already hold `userData`):
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/seed-review-kit.mjs <kit-folder>
 *
 * It prints the two project paths ready for `DSPATCH_CHAT_SWITCH_PROJECTS` and the
 * definition ready for `DSPATCH_PICK_FILE` (or `DSPATCH_REVIEW_DEFINITION`).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ProjectStore } from '../src/main/project-store';
import { makeReviewFixture, writeWalkDefinition } from '../tests/support/review-fixture';

const kitArgument = process.argv[2];
if (kitArgument === undefined || kitArgument.trim() === '') {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/seed-review-kit.mjs <kit-folder>');
  process.exit(2);
}
const KIT = path.resolve(kitArgument);
const USERDATA = path.join(KIT, 'userData');
if (fs.existsSync(USERDATA)) {
  console.error(`${USERDATA} already exists; seed a fresh kit folder.`);
  process.exit(2);
}
fs.mkdirSync(USERDATA, { recursive: true });

fs.mkdirSync(path.join(KIT, 'p1'));
fs.mkdirSync(path.join(KIT, 'p2'));
const one = makeReviewFixture(path.join(KIT, 'p1'));
const two = makeReviewFixture(path.join(KIT, 'p2'), { repoName: 'other', variant: 'P2' });
const definition = writeWalkDefinition(one);

const projects = new ProjectStore(path.join(USERDATA, 'dspatch-projects.json'));
const base = Date.now() - 60 * 60 * 1000;
// Oldest first, so P1 ends up at the top of Recent.
[two.repo, one.repo].forEach((project, index) => {
  const state = projects.recordOpened(project, { atUtc: new Date(base + index * 60_000).toISOString() });
  if (state.error !== null) {
    throw new Error(state.error);
  }
});

const summary = {
  kit: KIT,
  userData: USERDATA,
  projects: { P1: one.repo, P2: two.repo },
  definition,
  revisions: { P1: { base: one.base, target: one.target }, P2: { base: two.base, target: two.target } },
  recent: projects.read().recentProjects.map((entry) => entry.path),
};
fs.writeFileSync(path.join(KIT, 'seed-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`DSPATCH_CHAT_SWITCH_PROJECTS=${one.repo};${two.repo}`);
console.log(`DSPATCH_PICK_FILE=${definition}`);
console.log(`userData=${USERDATA}`);
