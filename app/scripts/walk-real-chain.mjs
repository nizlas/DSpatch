// @ts-nocheck: an evaluation harness over the product's job service and adapter factory.
/**
 * A walk preparation through DSpatch's own chain with a real provider (DSP-195): the host's job
 * service (`ReviewAgentJobs`), the revision snapshot, the one-call walk prompt or the walk loop's
 * drawing, roles and engine, the product's readers and checks, and the walk definition it writes.
 * The provider is the product's own adapter (the analysis policy) from its adapter factory, wrapped
 * only to keep every prompt it is sent and every answer it gives, with the model the provider
 * reports. Nothing is simulated and nothing is answered by hand.
 *
 * What it does not run: the windows (what the Step view shows of the definition is read from the
 * definition's fields and checked separately in a window trial).
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/walk-real-chain.mjs --case attach --method single --profile essens --out <dir>
 *
 * Cases: attach (tests/support/synthetic-attach.ts), connect (tests/support/synthetic-walks.ts).
 */
for (const key of Object.keys(process.env)) {
  if (/^(CLAUDE|ANTHROPIC)/i.test(key) || key.startsWith('DSPATCH_')) delete process.env[key];
}
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { ReviewAgentJobs } = await import('../src/host/review-agent-jobs');
const { ReviewPairs } = await import('../src/host/review-pairs');
const { RevisionSnapshots } = await import('../src/host/revision-snapshots');
const { isPairError } = await import('../src/shared/review-pair');
const { providerAdapters } = await import('../src/main/provider-adapters');
const { copilotRuntimeInstalled } = await import('../src/adapter/copilot-sdk-adapter');
const { CONNECT_CASE, makeSyntheticRepo } = await import('../tests/support/synthetic-walks');
const { ATTACH_CASE } = await import('../tests/support/synthetic-attach');
const { EXEC_DEBUG_CASE } = await import('../tests/support/synthetic-exec-debug');
const { WRITING_CONTENT_RULES } = await import('../src/shared/review-agent');
const { EXPLANATION_TASK, PRESENTATION_INSTRUCTION_VERSION } = await import('../src/shared/presentation-profiles');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const which = arg('--case', 'attach');
const method = arg('--method', 'single');
const profile = arg('--profile', 'essens');
const provider = arg('--provider', 'copilot');
const model = arg('--model', 'default');
// `--variant neutral-content` (DSP-195 ablation, an experiment on the prompt text, not a product
// prompt): the one-call prompt's profile-blind content lines made neutral before sending.
const variant = arg('--variant', '');
const VARIANTS = {
  'neutral-content': (prompt) =>
    prompt
      .replace('- Each step says what happens, why it happens or is needed, and what is worth noticing in the code. Give the needed context before the details.\n', '')
      .replace('"body": "The explanation in Markdown: what happens, why, what to notice in the code. Short paragraphs, bullets where they help."', '"body": "The step\'s explanation for the reader of the profile above, in Markdown."')
      .replace('"why": "Optional: the consequence, if it needs saying apart from the body."', '"why": "Optional, usually empty."'),
};
// `--variant v9` (DSP-195): the version 10 one-call prompt with every version 10 change in it put
// back to its version 9 text, so the before can be sampled again on the same code and harness. The
// changes in this prompt are all textual: the shared task, the writing rules' reader and content
// rules, the schema's descriptions of body and why, and the version line.
const V9_TASK = 'Explain this code to a person reviewing the change, who reads your text beside the code itself. Say what the code does here and why it matters for the change, how it connects to what the reader has seen and will see, and what the reader must understand to judge it: a condition that decides the outcome, a risk, work that is only requested or reused rather than done.';
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`v9: not in the prompt: ${from.slice(0, 60)}`);
  return text.split(from).join(to);
};
VARIANTS.v9 = (prompt) => {
  if (PRESENTATION_INSTRUCTION_VERSION !== 10) throw new Error('the v9 variant undoes version 10 exactly; check it against the current version');
  let text = swap(prompt, EXPLANATION_TASK[0], V9_TASK);
  text = swap(text, `Instruction version: 10\n`, `Instruction version: 9\n`);
  const concrete = '- Use concrete language and say who does what: the user, DSpatch, the provider, or a named component.\n';
  text = swap(text, concrete, `- ${WRITING_CONTENT_RULES[0]}\n- ${WRITING_CONTENT_RULES[1]}\n${concrete}- ${WRITING_CONTENT_RULES[2]}\n- ${WRITING_CONTENT_RULES[3]}\n`);
  text = swap(text, JSON.stringify('The step\'s explanation in Markdown, for the reader named under "How to explain the steps".'), JSON.stringify('The explanation in Markdown: what happens, why, what to notice in the code. Short paragraphs, bullets where they help.'));
  text = swap(text, JSON.stringify('Optional: a consequence this reader needs said apart from the body; usually empty.'), JSON.stringify('Optional: the consequence, if it needs saying apart from the body.'));
  return text;
};
const rewrite = variant === '' ? (prompt) => prompt : VARIANTS[variant];
if (rewrite === undefined) throw new Error(`unknown variant ${variant}`);
const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const repoRoot = path.resolve(appDir, '..');
const out = path.resolve(arg('--out', path.join(appDir, 'release', 'walk-real-chain', `${which}-${method}-${profile}-${String(Date.now())}`)));
fs.mkdirSync(path.join(out, 'exchange'), { recursive: true });
const CASES = { attach: ATTACH_CASE, connect: CONNECT_CASE, 'exec-debug': EXEC_DEBUG_CASE };
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp195-'));
const repo = { workspace, ...makeSyntheticRepo(workspace, CASES[which]) };
const log = (message) => {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(out, 'harness.log'), `${line}\n`);
};

const factory = providerAdapters({
  presentation: false,
  claudeAuthorizationReference: provider === 'claude' ? "DSP-195 chain trace on Niclas's go-ahead" : null,
  claudeInstalled: true,
  copilotInstalled: copilotRuntimeInstalled(),
  copilotRequireManagedHooks: false,
  log: () => undefined,
});
let turn = 0;
/** The product's adapter, with every prompt and answer kept; nothing is changed on the way. */
function keptAdapter() {
  const inner = factory.createAdapter({ provider, purpose: 'analysis' });
  const texts = new Map();
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'send') {
        return async (sessionId, prompt, ...rest) => {
          turn += 1;
          const number = String(turn).padStart(3, '0');
          const task = prompt.slice('DSPATCH-REVIEW-TASK:'.length).split('\n')[0]?.trim() ?? '';
          const changed = task === 'prepare-walks' || task === 'repair-walks' ? rewrite(prompt) : prompt;
          if (variant !== '' && changed === prompt && task === 'prepare-walks') throw new Error(`the variant ${variant} changed nothing`);
          prompt = changed;
          fs.writeFileSync(path.join(out, 'exchange', `turn-${number}-${task}.prompt.md`), prompt);
          texts.set(sessionId, { number, task, text: '', model: null });
          log(`turn ${number} sent (${task})`);
          return target.send(sessionId, prompt, ...rest);
        };
      }
      if (prop === 'subscribe') {
        return (sessionId, listener) =>
          target.subscribe(sessionId, (event) => {
            const kept = texts.get(sessionId);
            if (kept !== undefined) {
              if (event.type === 'assistant.delta') kept.text += event.text ?? '';
              if (event.type === 'assistant.message' && typeof event.text === 'string') kept.text = event.text;
              for (const key of ['model', 'modelUsed', 'resolvedModel']) if (typeof event[key] === 'string' && event[key] !== '') kept.model = event[key];
              const rawModel = event.rawProviderEvent?.data?.model;
              if (typeof rawModel === 'string' && rawModel !== '') kept.model = rawModel;
              // The Claude adapter keeps the model its SDK's init message reported.
              if (event.type === 'run.finished' && kept.model === null && typeof target.modelReported === 'function') kept.model = target.modelReported(sessionId);
              if (event.type === 'run.finished' && kept.model === null && typeof target.defaultSelected === 'string') kept.model = `${target.defaultSelected} (the runtime's selected default)`;
              if (event.type === 'run.finished') {
                fs.writeFileSync(path.join(out, 'exchange', `turn-${kept.number}-${kept.task}.answer.md`), kept.text);
                fs.appendFileSync(path.join(out, 'turns.jsonl'), `${JSON.stringify({ turn: kept.number, task: kept.task, status: event.status, chars: kept.text.length, modelReported: kept.model, event: Object.keys(event) })}\n`);
                log(`turn ${kept.number} finished (${String(event.status)}, ${String(kept.text.length)} chars, model ${String(kept.model)})`);
              }
            }
            listener(event);
          });
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const records = path.join(out, 'records');
const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
await pairs.repositories([repo.workspace]);
const opened = await pairs.openPair({ repository: repo.repo, base: repo.base, target: repo.target });
if (isPairError(opened)) throw new Error(opened.error);
const jobs = new ReviewAgentJobs({
  recordsDir: records,
  createAdapter: () => keptAdapter(),
  snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions'), log: (message) => log(`snapshots: ${message}`) }),
  availability: () => ({ choosable: true, reason: null }),
  pairs,
  language: () => Promise.resolve('en'),
  log: (message) => log(`jobs: ${message}`),
  loopResources: repoRoot,
  appVersion: 'walk-real-chain',
});
const started = jobs.start(opened.key, { kind: 'walks', provider, model, method, presentation: { profile } });
if (isPairError(started)) throw new Error(started.error);
log(`job ${started.id} started: ${which}, ${method}, ${profile}, ${provider}/${model}`);
let job;
for (;;) {
  job = pairs.state(opened.key).jobs.find((entry) => entry.id === started.id);
  if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
log(`job ended ${job.state}: ${job.note}${job.detail ? ` (${job.detail})` : ''}`);
fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify({ which, method, profile, provider, model, job }, (key, value) => (typeof value === 'string' ? value.split(os.homedir()).join('<home>') : value), 2)}\n`);
if (job.definitionPath) fs.copyFileSync(job.definitionPath, path.join(out, 'definition.review.json'));
if (job.loop?.recordPath && fs.existsSync(job.loop.recordPath)) fs.copyFileSync(job.loop.recordPath, path.join(out, 'record.jsonl'));
await jobs.dispose();
process.exit(job.state === 'done' ? 0 : 1);
