/**
 * Seed a kit for the `pair-review` scenario (DSP-150): a user-data folder whose only
 * project is a workspace with two Git repositories and a folder without Git.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/seed-pair-kit.mjs <kit-folder> [--agent claude] [--model <id>]
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
// DSP-152: the agent the kit's person chose (Cursor when absent) and the model chosen for
// it, as the chat's own choices would have stored them.
/** @param {string} name */
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at > 2 ? (process.argv[at + 1] ?? null) : null;
};
const AGENT = option('--agent') ?? 'cursor';
const MODEL = option('--model');
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
const fixture = makePairFixture(workspace);

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
fs.writeFileSync(path.join(KIT, 'kit.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ kit: KIT, workspace, walk: fixture.walkDefinition }));
