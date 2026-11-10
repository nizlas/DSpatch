// @ts-nocheck: an evaluation harness over the product's prompt builders and adapter factory.
/**
 * The explanation profiles on one locked walk plan, with a real provider (DSP-194).
 *
 * The plan is the one the planner wrote in the DSP-192 real-provider Standard run (kept in
 * docs/evaluations/dsp-192/real/records), read with the product's own `readPlanAnswer`; the code is
 * the synthetic connect case (generic code, not the person's), written as the revision folder the
 * host writes (base/ and target/). The prompts are built by the product's own builders: the loop
 * writer's `writeStepPrompt` and the step explanation channel's `stepExplanationPrompt`, with the
 * envelope filled as the host fills it (the walk's own text of the step is its short part, the
 * step's places are the code). Each prompt is sent through the product's own adapter factory with
 * the analysis policy (read-only tools in the revision folder), one fresh session per prompt.
 *
 * What it does not run: the job service, the run engine and the planner turn (the plan is reused,
 * not planned again), the reviewer, the explanation channel's store and the windows. The writer's
 * turns are first turns in fresh sessions; in the loop the writer's later steps share one session.
 *
 *   --phase ablation   at the current instructions: Standard and Essentials by the writer, Essentials
 *                      by the writer without the planner's briefs, Essentials as an alternative after
 *                      Standard as built, with the answer format's content rules taken out, and with
 *                      the walk's own text taken out. The variations are made on the built prompt
 *                      text here, to test what drives the detail; they are not product prompts.
 *   --phase final      at the current instructions: Essentials, Standard and Teacher by the writer,
 *                      then Essentials and Teacher as alternatives after this run's own Standard.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/profile-locked-compare.mjs --phase final --provider copilot --out <dir>
 */
for (const key of Object.keys(process.env)) {
  if (/^(CLAUDE|ANTHROPIC)/i.test(key) || key.startsWith('DSPATCH_')) delete process.env[key];
}
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { providerAdapters } = await import('../src/main/provider-adapters');
const { copilotRuntimeInstalled } = await import('../src/adapter/copilot-sdk-adapter');
const { CONNECT_CASE, makeSyntheticRepo } = await import('../tests/support/synthetic-walks');
const { ATTACH_CASE } = await import('../tests/support/synthetic-attach');
const { EXEC_DEBUG_CASE } = await import('../tests/support/synthetic-exec-debug');
const { createFileRoleResolver } = await import('../src/main/loop-graph-roles');
const { stepExplanationPrompt } = await import('../src/main/step-explanation-channel');
const { loadLoopGraph } = await import('../src/shared/loop-graph-load');
const { PRESENTATION_INSTRUCTION_VERSION, PROFILES, DETAILS_MARKER } = await import('../src/shared/presentation-profiles');
const { folderSection } = await import('../src/shared/review-agent');
const { WALK_LOOP_GRAPH_REL, readPlanAnswer, writeStepPrompt } = await import('../src/shared/walk-loop');
const { ReviewPairs } = await import('../src/host/review-pairs');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const phase = arg('--phase', 'final');
// DSP-195: another case, plan and steps (defaults: DSP-194's connect case, plan and steps).
const CASE = { connect: CONNECT_CASE, attach: ATTACH_CASE, 'exec-debug': EXEC_DEBUG_CASE }[arg('--case', 'connect')];
const planRecordArg = arg('--plan-record', '');
const stepsArg = arg('--steps', 'W1.1,W1.5');
const provider = arg('--provider', 'copilot');
const model = arg('--model', '');
const concurrency = Number(arg('--concurrency', '3'));
const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const repoRoot = path.resolve(appDir, '..');
const out = path.resolve(arg('--out', path.join(appDir, 'release', 'profile-locked', `${phase}-${String(Date.now())}`)));
fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
fs.mkdirSync(path.join(out, 'answers'), { recursive: true });

// --- The code and the revision folder ----------------------------------------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp194-'));
const made = makeSyntheticRepo(scratch, CASE);
const revisions = path.join(scratch, 'revisions');
for (const [side, files] of [['base', CASE.base], ['target', CASE.target]]) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(revisions, side, name)), { recursive: true });
    fs.writeFileSync(path.join(revisions, side, name), text);
  }
}
// The material the host gives the writer: the pair, its files and the opening diff, by the host's own method.
const pairs = new ReviewPairs({ recordsDir: path.join(scratch, 'records'), changed: () => undefined });
await pairs.repositories([scratch]);
const opened = await pairs.openPair({ repository: made.repo, base: made.base, target: made.target });
if ('error' in opened) throw new Error(opened.error);
const material = await pairs.material(opened.key);
if ('error' in material) throw new Error(material.error);
const folder = { base: made.base, target: made.target, files: 4, skipped: [], skippedCount: 0 };

// --- The locked plan ----------------------------------------------------------------------------
const record = planRecordArg !== '' ? path.resolve(planRecordArg) : path.join(repoRoot, 'docs/evaluations/dsp-192/real/records/generated/r-ce710726fc90476faf1c3b02/job-a40a96cc-c07a-4c84-ac4d-71d171580436.walk-loop/record.jsonl');
const planReply = fs.readFileSync(record, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.line === 'agent-reply' && line.reply.nodeId === 'plan').reply.text;
const planJson = JSON.parse(/```json\s*([\s\S]*?)```/.exec(planReply)?.[1] ?? planReply);
const read = readPlanAnswer(planJson);
if (read.plan === null) throw new Error(`the plan could not be read: ${read.problems.join(' ')}`);
const plan = read.plan;
fs.writeFileSync(path.join(out, 'plan.json'), `${JSON.stringify(planJson, null, 2)}\n`);
const resolveRole = createFileRoleResolver(repoRoot);
const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, WALK_LOOP_GRAPH_REL), 'utf8'), { resolveRole, connectedTargets: null });
const role = resolveRole(loaded.graph.nodes.find((node) => node.id === 'write').role);
const STEPS = stepsArg.split(',');
const walkOf = (stepId) => planJson.walks[Number(stepId.split('.')[0].slice(1)) - 1];
const walkRaw = planJson.walks[0];
const stepRaw = (stepId) => walkOf(stepId).steps[Number(stepId.split('.')[1]) - 1];

// --- The provider -------------------------------------------------------------------------------
const factory = providerAdapters({
  presentation: false,
  claudeAuthorizationReference: provider === 'claude' ? "DSP-194 locked-plan comparison on Niclas's go-ahead" : null,
  claudeInstalled: true,
  copilotInstalled: copilotRuntimeInstalled(),
  copilotRequireManagedHooks: false,
  log: () => undefined,
});
const why = factory.preflight({ provider, purpose: 'analysis' });
if (why !== null) throw new Error(`${provider} cannot be used: ${why}`);
const adapter = factory.createAdapter({ provider, purpose: 'analysis' });
const runs = [];

async function ask(name, prompt, note) {
  fs.writeFileSync(path.join(out, 'prompts', `${name}.md`), prompt);
  const startedAt = Date.now();
  const session = await adapter.startSession({ provider, modelRequested: model, workspacePath: revisions });
  let text = '';
  let reported = null;
  const finished = new Promise((resolve) => {
    adapter.subscribe(session.dspatchSessionId, (event) => {
      if (event.type === 'assistant.delta') text += event.text ?? '';
      if (event.type === 'assistant.message' && typeof event.text === 'string') text = event.text;
      if (event.model !== undefined && event.model !== null) reported = event.model;
      if (typeof event.rawProviderEvent?.data?.model === 'string' && event.rawProviderEvent.data.model !== '') reported = event.rawProviderEvent.data.model;
      if (event.type === 'run.finished') resolve(event);
    });
  });
  await adapter.send(session.dspatchSessionId, prompt);
  const end = await Promise.race([finished, new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 15 * 60_000))]);
  fs.writeFileSync(path.join(out, 'answers', `${name}.md`), text);
  // The Claude adapter keeps the model its SDK's init message reported (DSP-195).
  if (reported === null && typeof adapter.modelReported === 'function') reported = adapter.modelReported(session.dspatchSessionId);
  const entry = { name, note, status: end.status, error: end.error?.message ?? null, seconds: Math.round((Date.now() - startedAt) / 1000), chars: text.length, modelReported: reported ?? (typeof adapter.defaultSelected === 'string' ? `${adapter.defaultSelected} (the runtime's selected default)` : null) };
  runs.push(entry);
  console.log(JSON.stringify(entry));
  return text;
}

async function pool(tasks) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  }));
  return results;
}

const writerPrompt = (profile, stepId) => writeStepPrompt({ role, plan, stepId, profile, language: 'en', material, folder, fresh: true, rework: null });
const shortOf = (text) => text.split(DETAILS_MARKER)[0].trim();
const targetLines = (p, start, end) => CASE.target[p].split('\n').slice(start - 1, end);

/** The step explanation channel's prompt for an alternative, with the envelope as the host fills it. */
function presentPrompt(profile, stepId, standardShort) {
  const raw = stepRaw(stepId);
  const places = raw.places;
  const focus = places[0];
  const envelope = {
    version: 1,
    identity: { title: `Code walks · ${CASE.name} ${made.base.slice(0, 7)}→${made.target.slice(0, 7)}`, definitionPath: '', definitionHash: '', repository: made.repo, base: { sha: made.base, subject: 'base commit' }, target: { sha: made.target, subject: 'target commit' } },
    language: 'en',
    subject: { kind: 'point', walkId: 'W1', stepId, placeIndex: 0 },
    selection: null,
    explanation: { walkNumber: 1, walkTitle: walkRaw.title, stepTitle: raw.title, summary: raw.summary ?? '', body: standardShort, why: '', placeLabel: focus.label, evidence: [] },
    overview: null,
    ranges: places.map((place, index) => ({ role: index === 0 ? 'focus' : 'context', path: place.path, side: place.side, sha: place.side === 'base' ? made.base : made.target, start: place.start, end: place.end, lines: place.side === 'base' ? CASE.base[place.path].split('\n').slice(place.start - 1, place.end) : targetLines(place.path, place.start, place.end), omittedLines: 0, problem: null })),
    notes: [],
    providerContext: '',
    builtAt: new Date().toISOString(),
  };
  const outline = {
    walkTitle: walkRaw.title,
    steps: walkRaw.steps.map((step, index) => ({ id: `W1.${String(index + 1)}`, title: step.title, places: step.places.map((at) => `${at.path} ${String(at.start)}–${String(at.end)} (${at.side === 'base' ? 'From' : 'To'})`) })),
    current: Number(stepId.split('.')[1]) - 1,
    otherWalks: planJson.walks.slice(1).map((walk, w) => ({ title: walk.title, steps: walk.steps.map((step, index) => ({ id: `W${String(w + 2)}.${String(index + 1)}`, title: step.title })) })),
  };
  return stepExplanationPrompt({ envelope, action: 'present', profile, chain: [], outline, folderSection: folderSection(material, folder) });
}

// The ablation's variations of a built prompt (an experiment on the text, not product prompts).
const withoutBriefs = (prompt) => prompt.split('\n').filter((line) => !/^\s*(?:- )?Brief: /.test(line)).join('\n');
const withoutAnswerContentRules = (prompt) =>
  prompt
    .replace(' An uncertainty or risk that changes the answer is said in this part, briefly; its evidence and explanation can go after the marker.', '')
    .split('\n')
    .filter((line) => !/^- (Give the cause and effect behind the answer|Keep apart what the code shows and what is still uncertain|Keep established class names and terms)/.test(line))
    .join('\n');
const withoutWalkText = (prompt) => prompt.replace(/\nSummary:\n[\s\S]*?(?=\n## )/, '\n');

const manifest = { phase, provider, model: model || '(the provider default)', instructionVersion: PRESENTATION_INSTRUCTION_VERSION, base: made.base, target: made.target, startedAt: new Date().toISOString(), runs };

if (phase === 'ablation') {
  const standard = await pool(STEPS.map((stepId) => () => ask(`writer-standard-${stepId}`, writerPrompt('standard', stepId), `the loop writer, Standard, ${stepId}`)));
  await pool([
    ...STEPS.map((stepId) => () => ask(`writer-essens-${stepId}`, writerPrompt('essens', stepId), `the loop writer, Essentials, ${stepId}, as built`)),
    ...STEPS.map((stepId) => () => ask(`writer-essens-${stepId}-nobrief`, withoutBriefs(writerPrompt('essens', stepId)), `the loop writer, Essentials, ${stepId}, with the planner's briefs taken out`)),
    ...STEPS.map((stepId, index) => () => ask(`present-essens-${stepId}`, presentPrompt('essens', stepId, shortOf(standard[index])), `Essentials after this run's Standard, ${stepId}, as built`)),
    ...STEPS.map((stepId, index) => () => ask(`present-essens-${stepId}-noformat`, withoutAnswerContentRules(presentPrompt('essens', stepId, shortOf(standard[index]))), `Essentials after Standard, ${stepId}, with the answer format's content rules taken out`)),
    ...STEPS.map((stepId, index) => () => ask(`present-essens-${stepId}-notext`, withoutWalkText(presentPrompt('essens', stepId, shortOf(standard[index]))), `Essentials after Standard, ${stepId}, with the walk's own text taken out`)),
  ]);
} else if (phase === 'ablation-195') {
  // DSP-195, at instruction version 10 (an experiment on the built text, not product prompts). The
  // earlier rounds of this phase (version 9: the writing rules' content line, the shared task and
  // the role purpose, the reference's calibration) became version 10 or were left out; their
  // prompts and answers are kept with the evidence. This round asks whether the profile-blind
  // shared rules together act as a content list for Essentials: "noshared" takes out the shared
  // rules on adding understanding and on scope, "noreading" the walk rules on orientation and
  // transitions, "core" both; reading the code stays in every variant. Two samples each, for the
  // loop writer and for the profile switch after this phase's own fixed Standard.
  const { EXPLANATION_TASK, WALK_READING_RULES } = await import('../src/shared/presentation-profiles');
  const without = (rules) => (prompt) => {
    let changed = prompt;
    for (const rule of rules) {
      const line = `- ${rule}\n`;
      if (!changed.includes(line)) throw new Error(`not in the prompt: ${rule.slice(0, 60)}`);
      changed = changed.split(line).join('');
    }
    return changed;
  };
  const VARIANTS = {
    asbuilt: (prompt) => prompt,
    noshared: without([EXPLANATION_TASK[2], EXPLANATION_TASK[3]]),
    noreading: without([WALK_READING_RULES[1], WALK_READING_RULES[2]]),
    core: without([EXPLANATION_TASK[2], EXPLANATION_TASK[3], WALK_READING_RULES[1], WALK_READING_RULES[2]]),
  };
  const fixedStandard = (stepId) => shortOf(fs.readFileSync(path.join(path.dirname(out), arg('--standard-from', 'dsp195-after-attach-claude'), 'answers', `writer-standard-${stepId}.md`), 'utf8'));
  await pool(
    Object.entries(VARIANTS).flatMap(([variant, change]) =>
      STEPS.flatMap((stepId) =>
        [1, 2].flatMap((n) => [
          () => ask(`writer-essens-${stepId}-${variant}-${String(n)}`, change(writerPrompt('essens', stepId)), `the loop writer, Essentials, ${stepId}, ${variant}, sample ${String(n)}`),
          () => ask(`present-essens-${stepId}-${variant}-${String(n)}`, change(presentPrompt('essens', stepId, fixedStandard(stepId))), `Essentials after a fixed Standard, ${stepId}, ${variant}, sample ${String(n)}`),
        ]),
      ),
    ),
  );
} else if (phase === 'calibration-196') {
  // DSP-196, a calibration trial (an experiment on the built text, not product prompts): each
  // profile's reader replaced by a definition of what the explanation is organised around, with a
  // completion condition inside the same definition, and one sentence added to the shared scope
  // rule. Everything else is the product's instruction at the current version. Baseline and variant
  // for the loop writer (the walk plan's context) and for the profile switch (an existing
  // explanation as material, fixed per step: the baseline writer's Standard text for Essentials and
  // Teacher, the baseline writer's Essentials text for Standard). One sample per cell, a second
  // for Essentials.
  const { EXPLANATION_TASK } = await import('../src/shared/presentation-profiles');
  const VARIANT_READER = {
    essens: 'The reader is an experienced developer who wants to orient quickly. Organise the explanation around what this code is for and its most important effect in the flow: summarise several code operations into one meaningful action that helps this reader orient, rather than going through the operations; this reader reads the ordinary mechanics in the code. When the reader understands the step\'s task, its connection to the flow and the decisive consequence, the base explanation is done; further relevant facts are not automatically further things to tell here. A detail belongs in the first part when the main picture would otherwise mislead; mechanics this reader may want next go after the marker, or stay in the step that treats them. What the walk has already established need not be repeated, and more complex code may need more room.',
    standard: 'The reader knows programming but not this code. Organise the explanation around how the central mechanism achieves the effect and how the parts work together, from a natural entry point rather than the parts in source order. The base explanation is done when the central mechanism is understandable; it does not go on through the rest of the surroundings. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer.',
    pedagog: 'The reader can program but may not know this language, library or mechanism. Organise the explanation around the understanding this reader must build to grasp the mechanism: the concepts it rests on, the intermediate steps and, where it helps, a concrete example or comparison, tied to what the code does here. Develop the concepts that understanding needs and no others: do not inventory every line or teach every term, and do not add facts to be longer than Standard. Use what the walk has established: a short reminder with a reference in a later step, not the same foundation derived again. State what a primitive guarantees before an argument rests on it, and name a fault for what it is: unsynchronised concurrent access with a writer is a data race, not a stale value. A local explanation beats a detached lesson, and the text may take the room understanding needs.',
  };
  const SCOPE_ADDED = ' These are the reader\'s perspective, not headings or a checklist, and the same facts may appear in several profiles; no profile goes on only because the material holds more facts.';
  const variant = (profile) => (prompt) => {
    const reader = PROFILES[profile].reader[0];
    const scope = EXPLANATION_TASK[3];
    if (!prompt.includes(reader)) throw new Error(`the ${profile} reader is not in the prompt`);
    if (!prompt.includes(scope)) throw new Error('the shared scope rule is not in the prompt');
    return prompt.split(reader).join(VARIANT_READER[profile]).split(scope).join(scope + SCOPE_ADDED);
  };
  fs.writeFileSync(path.join(out, 'variant.json'), `${JSON.stringify({ baselineReaders: Object.fromEntries(['essens', 'standard', 'pedagog'].map((p) => [p, PROFILES[p].reader[0]])), variantReaders: VARIANT_READER, sharedScopeRule: EXPLANATION_TASK[3], addedToSharedScopeRule: SCOPE_ADDED.trim() }, null, 2)}\n`);
  const PROFILE_IDS = ['essens', 'standard', 'pedagog'];
  const samples = (profile) => (profile === 'essens' ? [1, 2] : [1]);
  const name = (kind, profile, stepId, version, n) => `${kind}-${profile}-${stepId}-${version}-${String(n)}`;
  // `--nobrief-only`: a diagnostic of the trial, the variant with the planner's briefs taken out
  // (the step list's and this step's), for the Essentials writer only, two samples per step.
  if (process.argv.includes('--nobrief-only')) {
    const noBrief = (prompt) => {
      const changed = withoutBriefs(prompt).replace(/^The planner's brief, written for every profile: .*$/m, '');
      if (changed === prompt) throw new Error('no brief was taken out');
      return changed;
    };
    await pool(STEPS.flatMap((stepId) => [1, 2].map((n) => () => ask(name('writer', 'essens', stepId, 'variant-nobrief', n), noBrief(variant('essens')(writerPrompt('essens', stepId))), `the loop writer, Essentials, ${stepId}, variant without the planner's briefs, sample ${String(n)}`))));
  } else {
  // The writer first; the baseline's first sample is the fixed material of the switch.
  const writerTasks = [];
  for (const profile of PROFILE_IDS) for (const stepId of STEPS) for (const n of samples(profile)) for (const version of ['baseline', 'variant']) {
    const build = () => writerPrompt(profile, stepId);
    writerTasks.push(() => ask(name('writer', profile, stepId, version, n), version === 'baseline' ? build() : variant(profile)(build()), `the loop writer, ${PROFILES[profile].promptName}, ${stepId}, ${version}, sample ${String(n)}`));
  }
  await pool(writerTasks);
  const material = (profile, stepId) => {
    const from = profile === 'standard' ? 'essens' : 'standard';
    return shortOf(fs.readFileSync(path.join(out, 'answers', `${name('writer', from, stepId, 'baseline', 1)}.md`), 'utf8'));
  };
  const presentTasks = [];
  for (const profile of PROFILE_IDS) for (const stepId of STEPS) for (const n of samples(profile)) for (const version of ['baseline', 'variant']) {
    const build = () => presentPrompt(profile, stepId, material(profile, stepId));
    presentTasks.push(() => ask(name('present', profile, stepId, version, n), version === 'baseline' ? build() : variant(profile)(build()), `${PROFILES[profile].promptName} as an alternative after the baseline ${profile === 'standard' ? 'Essentials' : 'Standard'} text, ${stepId}, ${version}, sample ${String(n)}`));
  }
  await pool(presentTasks);
  }
} else if (phase === 'v8-teacher') {
  // Teacher at version 8, for the before-picture: the version 9 prompts with the DSP-194 changes
  // turned back, exactly (the brief's label and the writer role's sentence; the profile section's
  // first line, the version and the answer format). Standard at version 8 is the ablation's.
  const { REVIEW_DISCUSSION_CODE_INSTRUCTION, ANSWER_SHAPE_RULES, CODE_ANSWER_RULES, PRESENTATION_ANSWER_RULES, PRESENTATION_CODE_RULES } = await import('../src/shared/review-discussion');
  void REVIEW_DISCUSSION_CODE_INSTRUCTION;
  const back = (prompt) => {
    let text = prompt
      .replace("The planner's brief, written for every profile: ", 'Brief: ')
      .replace("The plan's brief is the planner's orientation, written before the profile is known: it says what the step is for and what the planner saw in its code. It is neither evidence nor a list of what must be said; your text rests on the code, and the profile decides which of the brief's points this reader needs.", "The plan's brief is orientation; it is not evidence, and your text rests on the code.")
      .replace('The first part is what this reader reads at once; the deepening goes after the marker line the answer format below names.', 'The first part is the short part the answer format below describes; the deepening goes after the marker line it names.')
      .replaceAll('Instruction version: 9', 'Instruction version: 8');
    const newForm = [...PRESENTATION_ANSWER_RULES, ...PRESENTATION_CODE_RULES].map((rule) => `- ${rule}`).join('\n');
    const oldForm = [...ANSWER_SHAPE_RULES, ...CODE_ANSWER_RULES].map((rule) => `- ${rule}`).join('\n');
    if (text.includes(newForm)) text = text.replace(newForm, oldForm);
    return text;
  };
  const v8standard = (stepId) => fs.readFileSync(path.join(path.dirname(out), 'ablation-v8', 'answers', `writer-standard-${stepId}.md`), 'utf8');
  await pool([
    ...STEPS.map((stepId) => () => ask(`writer-pedagog-${stepId}-v8`, back(writerPrompt('pedagog', stepId)), `the loop writer, Teacher, ${stepId}, at version 8`)),
    ...STEPS.map((stepId) => () => ask(`present-pedagog-${stepId}-v8`, back(presentPrompt('pedagog', stepId, shortOf(v8standard(stepId)))), `Teacher after the version 8 Standard, ${stepId}, at version 8`)),
  ]);
} else {
  const written = await pool(['standard', 'essens', 'pedagog'].flatMap((profile) => STEPS.map((stepId) => () => ask(`writer-${profile}-${stepId}`, writerPrompt(profile, stepId), `the loop writer, ${PROFILES[profile].promptName}, ${stepId}`))));
  const standard = Object.fromEntries(STEPS.map((stepId, index) => [stepId, written[index]]));
  await pool(['essens', 'pedagog'].flatMap((profile) => STEPS.map((stepId) => () => ask(`present-${profile}-${stepId}`, presentPrompt(profile, stepId, shortOf(standard[stepId])), `${PROFILES[profile].promptName} as an alternative after this run's Standard, ${stepId}`))));
}
manifest.endedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, (key, value) => (typeof value === 'string' ? value.split(os.homedir()).join('<home>') : value), 2)}\n`);
await adapter.dispose();
console.log(`done: ${out}`);
process.exit(0);
