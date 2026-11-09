/**
 * DSP-185, DSP-188: write the exact prompts DSpatch would send for a synthetic case, so they can
 * be given to a model outside DSpatch for an independent qualitative check. Nothing is sent to
 * any provider here. The revision folder the prompts name is copied beside them
 * (`revisions/base`, `revisions/target`): run the check with that folder as the working folder
 * and read-only tools, as DSpatch's session would.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> [--case work-queue|connect] [--step W1.2] [--action present|regenerate|more|simpler] [--language en|sv]
 *     node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> --case connect --selection src/link.ts:17-30
 *     node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> --case connect --walks [--profile essens|standard|pedagog]
 *
 * Cases (tests/support/synthetic-walks.ts): `work-queue`, a queue with a mutex-protected map of
 * shared job slots, an acquire that finds or creates a slot and notifies, a worker loop that
 * waits and processes, and a caller (steps W1.1 the caller, W1.2 acquire, W1.3 the worker
 * loop); `connect`, a connection with alternative outcomes and a deferred callback (W1.1 the
 * caller, W1.2 connect with its retries and two outcomes, W1.3 settle and the callback).
 *
 * Writes `<step>-<action>-<Profile>.prompt.md` for each profile, or `selection-<path>-<lines>.prompt.md`,
 * or `walks-<Profile>.prompt.md`, and `revisions/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildExplanationPrompts, buildSelectionPrompt, buildWalksPrompt } from '../tests/support/explain-prompts';

const args = process.argv.slice(2);
const valued = ['--case', '--step', '--action', '--language', '--selection', '--profile'];
const out = args.find((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1] ?? ''));
/** An option's value, as given; checked where it is used. @param {string} name @returns {any} */
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
if (out === undefined) {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> [--case work-queue|connect] [--step W1.2] [--action present] [--language en] | --selection <path>:<start>-<end> | --walks [--profile <id>]');
  process.exit(2);
}
const caseName = option('--case') ?? 'work-queue';
const language = option('--language');
fs.mkdirSync(out, { recursive: true });
/** The snapshot's files are read-only, so an earlier copy in `out` is removed before the folder is copied again. @param {string} from */
const copyRevisions = (from) => {
  const target = path.join(out, 'revisions');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(from, target, { recursive: true });
};

if (args.includes('--walks')) {
  const built = await buildWalksPrompt({ caseName, profile: option('--profile') ?? null, language });
  try {
    const file = path.join(out, `walks-${option('--profile') ?? 'no-profile'}.prompt.md`);
    fs.writeFileSync(file, built.prompt);
    console.log(`${file} (${String(built.prompt.length)} characters)`);
    copyRevisions(built.revisionFolder);
  } finally {
    built.dispose();
  }
} else if (option('--selection') !== undefined) {
  const match = /^(.+):(\d+)-(\d+)$/.exec(option('--selection'));
  if (match === null) {
    console.error('--selection takes <path>:<start>-<end>');
    process.exit(2);
  }
  const [, selectedPath = '', startText = '0', endText = '0'] = match;
  const built = await buildSelectionPrompt({ caseName, path: selectedPath, start: Number(startText), end: Number(endText), language });
  try {
    const file = path.join(out, `selection-${selectedPath.replace(/[\\/]/g, '_')}-${startText}-${endText}.prompt.md`);
    fs.writeFileSync(file, built.prompt);
    console.log(`${file} (${String(built.prompt.length)} characters)`);
    copyRevisions(built.revisionFolder);
  } finally {
    built.dispose();
  }
} else {
  const built = await buildExplanationPrompts({ caseName, stepId: option('--step'), action: option('--action'), language });
  try {
    for (const [profile, prompt] of Object.entries(built.prompts)) {
      const file = path.join(out, `${built.stepId}-${built.action}-${profile}.prompt.md`);
      fs.writeFileSync(file, prompt);
      console.log(`${file} (${String(prompt.length)} characters)`);
    }
    copyRevisions(built.revisionFolder);
    console.log(`${path.join(out, 'revisions')} (the revision folder the prompts name: base/ and target/)`);
  } finally {
    built.dispose();
  }
}
