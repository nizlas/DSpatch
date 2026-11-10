// DSP-192: the prompts for a comparison of the three profiles on one locked walk plan, revision and
// steps, built by the product's own prompt builders (the loop writer's step prompt, and the step
// explanation channel's prompt for a profile alternative made after the walk), so that a stand-in
// model can answer them with the same code access. Writes the prompts and a manifest; the answers
// are written by whoever plays the agent.
//
//     node --import ./scripts/ts-resolve.mjs scripts/profile-compare.mjs <out folder> [<baseline instructions file>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONNECT_CASE, makeSyntheticRepo } from '../tests/support/synthetic-walks.ts';
import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import { stepExplanationPrompt } from '../src/main/step-explanation-channel.ts';
import { loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { PRESENTATION_INSTRUCTION_VERSION, PROFILES, SAME_FACTS_RULES, DEEPENING_RULES } from '../src/shared/presentation-profiles.ts';
import { folderSection } from '../src/shared/review-agent.ts';
import { WALK_LOOP_GRAPH_REL, readPlanAnswer, writeStepPrompt } from '../src/shared/walk-loop.ts';

const out = path.resolve(process.argv[2] ?? 'release/profile-compare');
const baselineFile = process.argv[3] ?? null;
const repoRoot = path.resolve('..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp192-'));
const { repo, base, target } = makeSyntheticRepo(scratch, CONNECT_CASE);
const revisions = path.join(scratch, 'revisions');
for (const [side, files] of [['base', CONNECT_CASE.base], ['target', CONNECT_CASE.target]]) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(revisions, side, name)), { recursive: true });
    fs.writeFileSync(path.join(revisions, side, name), text);
  }
}
const resolveRole = createFileRoleResolver(repoRoot);
const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, WALK_LOOP_GRAPH_REL), 'utf8'), { resolveRole, connectedTargets: null });
const writeNode = loaded.graph.nodes.find((node) => node.id === 'write');
const role = resolveRole(writeNode.role);

// The plan the DSP-189 connect run (second run) delivered, first walk, as the planner wrote it.
const place = (label, p, start, end, from) => ({ label, path: p, side: 'target', start, end, ...(from === undefined ? {} : { from }) });
const PLAN_RAW = {
  summary: "Link.connect no longer hands back a single transport.open result. It now tries up to maxAttempts times (a new constructor option, default 3), waits attempts × 100 ms after each failed open, and reports the outcome twice: as the string it returns ('connected' or 'gave-up') and through a callback registered with whenSettled, which settle schedules on a zero-delay timer. startSession takes a report sink, registers that callback before connecting, and reports 'retrying later' itself when connect gave up.",
  background: "The repository at both revisions holds only src/link.ts and src/session.ts: nothing in it constructs a Link, calls startSession or tests either, so the default of three attempts and the pause after the last failure are read from the code, not observed.",
  walks: [
    {
      kind: 'walk',
      title: "A connection that succeeds: from startSession to 'session ready'",
      question: "What happens when the transport opens, and when does the caller hear 'session ready'?",
      purpose: 'How the new callback and the new return value both carry a successful connection back to the caller, and in which order.',
      steps: [
        { title: 'startSession registers the settled callback', summary: "Before connecting, startSession hands the Link a callback that turns the outcome into 'session ready' or 'offline mode'.", brief: "Show the new shape of startSession against the From side's bare await: it now receives a report sink and, before anything is attempted, registers a callback that closes over report. Make clear that registering calls nothing yet; the reader takes to the next step that the Link now holds this callback and that connect is called right after.", places: [place("startSession's signature and the whenSettled registration", 'src/session.ts', 3, 4)] },
        { title: 'Link.whenSettled keeps one callback', summary: "The callback is stored in the Link's single onSettled slot; nothing runs yet.", brief: 'Reached from startSession\'s call at line 4. Make comprehensible that this is a plain assignment into the onSettled field declared at line 9 (one slot, so a later call replaces an earlier one) and that the Link, not startSession, decides when it is called. The reader takes along that the slot is full when connect starts.', places: [place('whenSettled stores the callback', 'src/link.ts', 13, 15, { label: 'The registration in startSession', path: 'src/session.ts', side: 'target', start: 4, end: 4 })] },
        { title: 'connect begins the attempt loop', summary: 'connect resets the counter and makes the first attempt by awaiting transport.open.', brief: "Reached from startSession's await at line 5. Explain the loop's frame: attempts is reset per call, the while compares it with maxAttempts (a constructor option, default 3), the counter is raised before each open so that it equals the number of attempts made, and the awaited transport.open is where the outside world answers. The reader takes along that the boolean from open decides the branch at line 22, and that this walk follows the true branch.", places: [place("connect's signature, the reset and the first attempt", 'src/link.ts', 17, 21, { label: 'The await in startSession', path: 'src/session.ts', side: 'target', start: 5, end: 5 })] },
        { title: "open returned true: settle, then return 'connected'", summary: "On success the Link settles the callback first and only then returns 'connected' to the caller.", brief: 'This is the branch we follow; the false branch is the second walk, which starts again at this if. Make the order visible: settle runs before the return, so whatever settle does is arranged before connect\'s promise resolves. The reader takes to the next step the question of what settle actually does with the callback.', places: [place('The success branch of the loop body', 'src/link.ts', 22, 25)] },
        { title: 'settle detaches the callback and defers it', summary: 'settle empties the onSettled slot and schedules the callback on a zero-delay timer instead of calling it inline.', brief: 'Reached from line 23. Make two things comprehensible: the slot is cleared before the callback is scheduled, so it fires at most once per registration and a later connect on the same Link finds no callback unless whenSettled is called again; and setTimeout(..., 0) means the callback runs in a later turn of the event loop, not inside connect. The reader takes along that when connect returns, nothing has been reported yet.', places: [place('The private settle method', 'src/link.ts', 32, 38, { label: 'The settle call on success', path: 'src/link.ts', side: 'target', start: 23, end: 23 })] },
        { title: "Back in startSession: 'connected' needs no extra report", summary: "The await resumes with 'connected', the gave-up check is skipped and startSession completes with nothing reported so far.", brief: "Reached by the return at line 24 resuming the await at line 5; this continuation runs as a promise microtask, before any timer. Make clear that for 'connected' the if does nothing and startSession's own promise resolves here, still without any report. The reader takes along that the only report on this path is still pending in the timer from the previous step.", places: [place('The await and the gave-up check in startSession', 'src/session.ts', 5, 8, { label: 'The return that resumes the await', path: 'src/link.ts', side: 'target', start: 24, end: 24 })] },
        { title: "The timer fires: 'session ready'", summary: "Later, from the timer settle scheduled, the callback reports 'session ready'.", brief: 'The context followed now is the timer callback set at line 36, not startSession, which has already returned. Explain, as read from the code and not observed, that a caller awaiting startSession is resumed before this report arrives, because promise continuations run before timers; the text comes from the ternary in the callback. Nothing follows this step.', revisit: "The callback registered in step 1 is now seen running, from the timer, with outcome 'connected'.", places: [place('The callback body, now running from the timer', 'src/session.ts', 4, 4, { label: 'The timer settle scheduled', path: 'src/link.ts', side: 'target', start: 36, end: 36 })] },
      ],
    },
  ],
};
const read = readPlanAnswer(PLAN_RAW);
if (read.plan === null) {
  throw new Error(`the plan could not be read: ${read.problems.join(' ')}`);
}
const plan = read.plan;
const material = { pair: { repository: repo, base, target }, repositoryName: 'connect', baseSubject: 'base commit', targetSubject: 'target commit', files: [], diff: '', diffLeftOut: [] };
const folder = { base, target, files: 4, skipped: [], skippedCount: 0 };

fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
fs.mkdirSync(path.join(out, 'answers'), { recursive: true });
// The temporary folders are named without the home directory: the manifest is kept in the repository.
const unhomed = (p) => p.split(os.homedir()).join('<home>');
const manifest = { version: PRESENTATION_INSTRUCTION_VERSION, revisions: unhomed(revisions), repo: unhomed(repo), base, target, prompts: [] };
const write = (name, text, note) => {
  fs.writeFileSync(path.join(out, 'prompts', `${name}.md`), text);
  manifest.prompts.push({ name, note });
};

for (const stepId of ['W1.1', 'W1.5']) {
  for (const profile of ['essens', 'standard', 'pedagog']) {
    const prompt = writeStepPrompt({ role, plan, stepId, profile, language: 'en', material, folder, fresh: true, rework: null });
    write(`writer-${profile}-${stepId}`, prompt, `the loop writer's prompt (first turn) for ${stepId} in ${PROFILES[profile].promptName}, instruction version ${String(PRESENTATION_INSTRUCTION_VERSION)}`);
  }
}

// A profile alternative made after the walk exists: the step explanation channel's prompt, with
// the walk's own Standard text of the step as the prepared explanation (the DSP-189 run's text).
const baselineStandard = fs.readFileSync(path.join(repoRoot, 'docs/evaluations/dsp-189/connect-loop-standard-2.md'), 'utf8');
const w15 = baselineStandard.slice(baselineStandard.indexOf('#### W1.5 settle detaches'), baselineStandard.indexOf('#### W1.6 Back in startSession'));
const w15Body = w15.slice(w15.indexOf('\n\n', w15.indexOf('- The private settle method')) + 2, w15.indexOf('**Show more:**')).trim();
const lines = (p, start, end) => fs.readFileSync(path.join(revisions, 'target', p), 'utf8').split('\n').slice(start - 1, end);
const envelope = {
  version: 1,
  identity: { title: 'connect · base→target', definitionPath: '', definitionHash: '', repository: repo, base: { sha: base, subject: 'base commit' }, target: { sha: target, subject: 'target commit' } },
  language: 'en',
  subject: { kind: 'point', walkId: 'W1', stepId: 'W1.5', placeIndex: 0 },
  selection: null,
  explanation: { walkNumber: 1, walkTitle: PLAN_RAW.walks[0].title, stepTitle: PLAN_RAW.walks[0].steps[4].title, summary: PLAN_RAW.walks[0].steps[4].summary, body: w15Body, why: '', placeLabel: 'The private settle method', evidence: [] },
  overview: null,
  ranges: [
    { role: 'focus', path: 'src/link.ts', side: 'target', sha: target, start: 32, end: 38, lines: lines('src/link.ts', 32, 38), omittedLines: 0, problem: null },
    { role: 'context', path: 'src/link.ts', side: 'target', sha: target, start: 23, end: 23, lines: lines('src/link.ts', 23, 23), omittedLines: 0, problem: null },
  ],
  notes: [],
  providerContext: '',
  builtAt: new Date().toISOString(),
};
const outline = { walkTitle: PLAN_RAW.walks[0].title, steps: PLAN_RAW.walks[0].steps.map((step, index) => ({ id: `W1.${String(index + 1)}`, title: step.title, places: step.places.map((at) => `${at.path} ${String(at.start)}–${String(at.end)} (To)`) })), current: 4 };
for (const profile of ['essens', 'pedagog']) {
  const prompt = stepExplanationPrompt({ envelope, action: 'present', profile, chain: [], outline, folderSection: folderSection(material, folder) });
  write(`present-${profile}-W1.5`, prompt, `the step explanation channel's prompt for a ${PROFILES[profile].promptName} alternative of W1.5 made after the walk (the walk's own text is the DSP-189 Standard text), instruction version ${String(PRESENTATION_INSTRUCTION_VERSION)}`);
}

// The same writer prompt for W1.5 in Essentials with the instructions of the version before this change.
if (baselineFile !== null) {
  const baseline = fs.readFileSync(baselineFile, 'utf8');
  const section = (heading) => {
    const at = baseline.indexOf(heading);
    const next = baseline.indexOf('\n## ', at + heading.length);
    return baseline.slice(at + heading.length, next < 0 ? undefined : next).trim();
  };
  const oldReader = section('## Essentials: the reader').replace(/^- /, '');
  const v8 = fs.readFileSync(path.join(out, 'prompts', 'writer-essens-W1.5.md'), 'utf8');
  const oldWriterSection = section('## The loop writer\'s instruction section, Teacher').replace(/^```\n?/, '').replace(/\n?```$/, '');
  const oldSame = [...oldWriterSection.matchAll(/^- (A profile changes how the step is presented.*|Present this step; do not start a new broad review.*)$/gm)].map((m) => m[1]);
  const oldDeepening = [...oldWriterSection.matchAll(/^- (After the marker line comes the deepening only.*)$/gm)].map((m) => m[1]);
  let v7 = v8.replace(`- ${PROFILES.essens.reader[0]}`, `- ${oldReader}`).replace(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`, 'Instruction version: 7');
  if (oldSame.length === 2) {
    v7 = v7.replace(`- ${SAME_FACTS_RULES[0]}`, `- ${oldSame[0]}`).replace(`- ${SAME_FACTS_RULES[1]}`, `- ${oldSame[1]}`);
  }
  if (oldDeepening.length === 1) {
    v7 = v7.replace(`- ${DEEPENING_RULES[0]}`, `- ${oldDeepening[0]}`);
  }
  const replaced = v7 !== v8 && v7.includes(oldReader) && !v7.includes(PROFILES.essens.reader[0]);
  write('writer-essens-W1.5-v7', v7, `the same writer prompt for W1.5 in Essentials with the instructions of version 7 (reader, boundary and deepening substituted from the baseline file; substitution ${replaced ? 'complete' : 'INCOMPLETE'})`);
}
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ out, revisions, prompts: manifest.prompts.map((entry) => entry.name) }, null, 2));
