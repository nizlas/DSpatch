/**
 * Seed a kit for the `pair-review` scenario (DSP-150): a user-data folder whose only
 * project is a workspace with two Git repositories and a folder without Git.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/seed-pair-kit.mjs <kit-folder>
 *
 * Writes `<kit>/userData`, `<kit>/workspace` and `<kit>/kit.json` (the walk definition
 * the scenario's file pick answers with). Nothing outside the kit folder is touched.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ProjectStore } from '../src/main/project-store';
import { makePairFixture } from '../tests/support/pair-fixture';

const kitArgument = process.argv[2];
if (kitArgument === undefined || kitArgument.trim() === '') {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/seed-pair-kit.mjs <kit-folder>');
  process.exit(2);
}
const KIT = path.resolve(kitArgument);
const USERDATA = path.join(KIT, 'userData');
if (fs.existsSync(USERDATA)) {
  console.error(`${USERDATA} already exists; seed a fresh kit folder.`);
  process.exit(2);
}
fs.mkdirSync(USERDATA, { recursive: true });
const workspace = path.join(KIT, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const fixture = makePairFixture(workspace);

// The kit's person chose Cursor; nothing in the scenario sends, and the presentation
// adapter answers in its place.
fs.writeFileSync(
  path.join(USERDATA, 'dspatch-agent-choice.json'),
  `${JSON.stringify({ formatVersion: 1, agent: 'cursor', chosenAtUtc: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
const projects = new ProjectStore(path.join(USERDATA, 'dspatch-projects.json'));
const outcome = projects.openFolder(workspace, new Date().toISOString());
if (outcome.problem !== null) {
  throw new Error(outcome.problem);
}
fs.writeFileSync(path.join(KIT, 'kit.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ kit: KIT, workspace, walk: fixture.walkDefinition }));
