// @ts-nocheck: a probe over the product's adapter factory, run with the TypeScript loader.
/**
 * Whether a provider answers through DSpatch's own adapter factory on this machine, with the
 * machine's existing sign-in: one analysis session in a scratch folder, one short turn, the
 * adapter's own events. Nothing of the person's DSpatch profile is read or written.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/provider-probe.mjs copilot [<model>]
 *     node --import ./scripts/ts-resolve.mjs scripts/provider-probe.mjs claude opus
 */
for (const key of Object.keys(process.env)) {
  // A shell inside Claude Code carries its own session's variables, which the Claude adapter refuses.
  if (/^(CLAUDE|ANTHROPIC)/i.test(key) || key.startsWith('DSPATCH_')) delete process.env[key];
}
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { providerAdapters } = await import('../src/main/provider-adapters');
const { copilotRuntimeInstalled } = await import('../src/adapter/copilot-sdk-adapter');

const provider = process.argv[2] ?? 'copilot';
const model = process.argv[3] ?? '';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-probe-'));
fs.writeFileSync(path.join(folder, 'note.txt'), 'The answer is 42.\n');
const factory = providerAdapters({
  presentation: false,
  claudeAuthorizationReference: provider === 'claude' ? 'provider probe on Niclas\'s go-ahead' : null,
  claudeInstalled: true,
  copilotInstalled: typeof copilotRuntimeInstalled === 'function' ? copilotRuntimeInstalled() : true,
  copilotRequireManagedHooks: false,
  log: (message) => console.log(`[log] ${message}`),
});
const why = factory.preflight({ provider, purpose: 'analysis' });
console.log('preflight', why ?? 'ok');
if (why !== null) process.exit(2);
const adapter = factory.createAdapter({ provider, purpose: 'analysis' });
if (typeof adapter.listModels === 'function') {
  const models = await adapter.listModels().catch((error) => `listModels failed: ${String(error)}`);
  console.log('models', Array.isArray(models) ? models.map((entry) => entry.id ?? entry).join(', ') : models);
}
const session = await adapter.startSession({ provider, modelRequested: model, workspacePath: folder });
let text = '';
const done = new Promise((resolve) => {
  adapter.subscribe(session.dspatchSessionId, (event) => {
    if (event.type === 'assistant.message') text = event.text ?? text;
    if (event.type === 'assistant.delta') text += event.text ?? '';
    if (event.type === 'run.finished') resolve(event);
  });
});
await adapter.send(session.dspatchSessionId, 'Read note.txt in your working folder and reply with exactly the number it gives, nothing else.');
const finished = await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 180_000))]);
console.log('finished', JSON.stringify({ status: finished.status, error: finished.error?.message ?? null, model: finished.model ?? null }), 'text', JSON.stringify(text.trim().slice(0, 200)));
await adapter.dispose();
process.exit(0);
