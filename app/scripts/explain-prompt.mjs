/**
 * DSP-185: write the exact step-explanation prompts DSpatch would send for a step of the
 * synthetic work-queue case (tests/support/synthetic-walks.ts: a queue with a mutex-protected
 * map of shared job slots, an acquire that finds or creates a slot, flags it and notifies, a
 * worker loop that waits and processes, and a caller), in Essentials, Standard and Teacher,
 * walk-aware sections included, so they can be given to a model outside DSpatch for an
 * independent qualitative check. The revision folder the prompts name is copied beside them
 * (`revisions/base`, `revisions/target`): run the check with that folder as the working folder
 * and read-only tools, as DSpatch's session would. Nothing is sent to any provider here.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> [--step W1.2] [--action present|regenerate|more|simpler] [--language en|sv]
 *
 * Steps: W1.1 the caller, W1.2 acquire (default), W1.3 the worker loop. Writes
 * `<step>-<action>-<Profile>.prompt.md` for each profile and `revisions/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildExplanationPrompts } from '../tests/support/explain-prompts';

const args = process.argv.slice(2);
const out = args.find((arg) => !arg.startsWith('--') && !['--step', '--action', '--language'].includes(args[args.indexOf(arg) - 1] ?? ''));
/** An option's value, as given; checked where it is used. @param {string} name @returns {any} */
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
if (out === undefined) {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/explain-prompt.mjs <output folder> [--step W1.2] [--action present] [--language en]');
  process.exit(2);
}
const built = await buildExplanationPrompts({ stepId: option('--step'), action: option('--action'), language: option('--language') });
try {
  fs.mkdirSync(out, { recursive: true });
  for (const [profile, prompt] of Object.entries(built.prompts)) {
    const file = path.join(out, `${built.stepId}-${built.action}-${profile}.prompt.md`);
    fs.writeFileSync(file, prompt);
    console.log(`${file} (${String(prompt.length)} characters)`);
  }
  fs.cpSync(built.revisionFolder, path.join(out, 'revisions'), { recursive: true });
  console.log(`${path.join(out, 'revisions')} (the revision folder the prompts name: base/ and target/)`);
} finally {
  built.dispose();
}
