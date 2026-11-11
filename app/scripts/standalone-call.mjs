// @ts-nocheck: an evaluation harness over the product's adapter factory.
/**
 * One standalone model call (DSP-198): a prepared prompt file sent once, in a new session, through
 * DSpatch's own Claude adapter for analysis work, with the invented example's two revisions as the
 * session's folder. No product prompt builder is used: no walk loop graph or role, no plan, no
 * `writeStepPrompt`, `walksPrompt`, `stepExplanationPrompt` or `presentationPromptSection`. The only
 * text DSpatch sends is the prompt file, with `{BASE_COMMIT}` and `{TARGET_COMMIT}` filled in.
 * What Claude Code adds on its own is read afterwards from its session transcript.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/standalone-call.mjs --prompt <prompt.md> --out <dir> [--model opus]
 */
for (const key of Object.keys(process.env)) {
  if (/^(CLAUDE|ANTHROPIC)/i.test(key) || key.startsWith('DSPATCH_')) delete process.env[key];
}
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { providerAdapters } = await import('../src/main/provider-adapters');
const { makeSyntheticRepo } = await import('../tests/support/synthetic-walks');
const { EXEC_DEBUG_CASE } = await import('../tests/support/synthetic-exec-debug');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const promptFile = path.resolve(arg('--prompt', ''));
const out = path.resolve(arg('--out', ''));
const model = arg('--model', 'opus');
if (!fs.existsSync(promptFile) || out === '') throw new Error('--prompt <file> and --out <dir> are needed');
fs.mkdirSync(out, { recursive: true });

// The code: the invented example's repository and its two revisions as files.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp198-standalone-'));
const made = makeSyntheticRepo(scratch, EXEC_DEBUG_CASE);
const revisions = path.join(scratch, 'revisions');
for (const [side, files] of [['base', EXEC_DEBUG_CASE.base], ['target', EXEC_DEBUG_CASE.target]]) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(revisions, side, name)), { recursive: true });
    fs.writeFileSync(path.join(revisions, side, name), text);
  }
}

// The prompt: the file as written, with the two commits filled in and nothing else.
const template = fs.readFileSync(promptFile, 'utf8');
if (!template.includes('{BASE_COMMIT}') || !template.includes('{TARGET_COMMIT}')) throw new Error('the prompt has no commit placeholders');
const prompt = template.split('{BASE_COMMIT}').join(made.base).split('{TARGET_COMMIT}').join(made.target);
fs.writeFileSync(path.join(out, 'prompt-sent.md'), prompt);

// The provider: the product's Claude adapter for analysis, a new session, one send.
const factory = providerAdapters({
  presentation: false,
  claudeAuthorizationReference: "DSP-198 standalone call on Niclas's go-ahead of 11 November 2026",
  claudeInstalled: true,
  copilotInstalled: false,
  copilotRequireManagedHooks: false,
  log: () => undefined,
});
const why = factory.preflight({ provider: 'claude', purpose: 'analysis' });
if (why !== null) throw new Error(`claude cannot be used: ${why}`);
const adapter = factory.createAdapter({ provider: 'claude', purpose: 'analysis' });
const session = await adapter.startSession({ provider: 'claude', modelRequested: model, workspacePath: revisions });
let text = '';
const finished = new Promise((resolve) => {
  adapter.subscribe(session.dspatchSessionId, (event) => {
    if (event.type === 'assistant.delta') text += event.text ?? '';
    if (event.type === 'assistant.message' && typeof event.text === 'string') text = event.text;
    if (event.type === 'run.finished') resolve(event);
  });
});
const startedAt = new Date().toISOString();
await adapter.send(session.dspatchSessionId, prompt);
const end = await Promise.race([finished, new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 15 * 60_000))]);
const reported = typeof adapter.modelReported === 'function' ? adapter.modelReported(session.dspatchSessionId) : null;
fs.writeFileSync(path.join(out, 'answer.md'), text);
const home = os.homedir();
const scrub = (value) => (typeof value === 'string' ? value.split(home).join('<home>') : value);
fs.writeFileSync(
  path.join(out, 'result.json'),
  `${JSON.stringify({ startedAt, endedAt: new Date().toISOString(), status: end.status, error: end.error?.message ?? null, provider: 'claude', modelRequested: model, modelReported: reported, dspatchSessionId: session.dspatchSessionId, folder: revisions, scratch, base: made.base, target: made.target, answerChars: text.length }, (key, value) => scrub(value), 2)}\n`,
);
await adapter.dispose();
console.log(JSON.stringify({ status: end.status, modelReported: reported, chars: text.length, scratch: scrub(scratch) }));
// The run's outcome is in result.json; the script itself has done its one call.
process.exit(0);
