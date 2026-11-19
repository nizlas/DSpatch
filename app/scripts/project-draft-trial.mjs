// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * DSP-230 window trial (extended for DSP-231: a shared role's identity in the node panel, a role
 * change and the additions it leaves, and the upgrade of an older graph to shared roles): project
 * instructions in the graph editor's right panel, one draft shared
 * with the customization window, "Discuss project instructions" and the chat's proposals, a change
 * on disk, Save and Discard changes, the run start's question, and a restart. This checkout's build
 * (npm run build), headless Electron, an isolated profile, the presentation adapter (SIMULATED: no
 * model is called; the chat's tool calls are made by `[[tool …]]` lines in the message, against the
 * host's real tools). Native dialogs are answered by replacing them in the main process.
 *
 *     node scripts/project-draft-trial.mjs [<evidence folder>]
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const kit = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-project-draft'));
const out = path.join(kit, `run-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, 'profile');
const project = path.join(out, 'orders-kit');
fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), '# repo\n');
fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Rules\nAlways run the tests.\n');
fs.writeFileSync(path.join(project, 'docs/ARCHITECTURE.md'), '# Architecture\n');
fs.writeFileSync(path.join(project, 'docs/TESTING.md'), '# Testing\n');
fs.writeFileSync(path.join(project, 'docs/A-VERY-LONG-DOCUMENT-NAME-THAT-SHOULD-WRAP-IN-A-NARROW-PANEL-WITHOUT-SCROLLING.md'), '# Long\n');
{
  const g = (...a) => execFileSync('git', a, { cwd: project });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@l'); g('config', 'commit.gpgsign', 'false'); g('add', '.'); g('commit', '-qm', 'first');
}
const instructionsFile = path.join(project, '.dspatch/loops/orders-workflow.project.json');
const electron = createRequire(path.join(appDir, 'package.json'))('electron');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const simulated = { DSPATCH_TRIAL_HOST_RUN: 'review-flow', DSPATCH_PRESENTATION_MODELS: 'copilot', DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated' };
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 600)}`); };
let child; let ws; let pending; let seq;
async function launch(label) {
  const inspect = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DSPATCH_') && !k.startsWith('COPILOT') && !k.startsWith('CLAUDE') && !k.startsWith('ANTHROPIC') && !['DISPLAY', 'WAYLAND_DISPLAY', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(k)));
  const log = fs.openSync(path.join(out, `client-${label}.log`), 'w');
  child = spawn(electron, [`--inspect=${inspect}`, '.', '--ozone-platform=headless', `--user-data-dir=${profile}`], { cwd: appDir, env: { ...env, XDG_CONFIG_HOME: path.join(out, 'xdg'), COPILOT_HOME: path.join(out, 'copilot-home'), DSPATCH_EXPECT_USERDATA: profile, ...simulated }, stdio: ['ignore', log, log] });
  ws = undefined; pending = new Map(); seq = 0;
  for (let i = 0; i < 80 && ws === undefined; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${inspect}/json/list`)).json();
      const s = new WebSocket(list[0].webSocketDebuggerUrl);
      await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; });
      s.onmessage = (e) => { const a = JSON.parse(e.data); const w = pending.get(a.id); pending.delete(a.id); if (w) a.error ? w.rej(new Error(JSON.stringify(a.error))) : w.res(a.result); };
      ws = s;
    } catch { await delay(500); }
  }
  await cmd('Runtime.enable');
  await until('main window', `Boolean(${mainWin}) && ${mainWin}.webContents.getURL() !== ''`);
  await until('bridge', `${mainWin}.webContents.executeJavaScript('typeof window.dspatch?.listLoopDefinitions === "function"')`);
  await delay(2500);
}
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const a = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (a.exceptionDetails) throw new Error(JSON.stringify(a.exceptionDetails).slice(0, 600)); return a.result?.value; };
const E = `process.mainModule.require('electron')`;
const until = async (what, expr, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return; } catch {} await delay(300); } throw new Error(`timeout: ${what}`); };
const mainWin = `${E}.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().includes('window='))`;
const editor = `${E}.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=editor'))`;
const inMain = (js) => ev(`${mainWin}.webContents.executeJavaScript(${JSON.stringify(js)})`);
const inEd = (js) => ev(`${editor}.webContents.executeJavaScript(${JSON.stringify(js)})`);
const untilEd = (what, js, ms) => until(what, `${editor}.webContents.executeJavaScript(${JSON.stringify(js)})`, ms);
const untilMain = (what, js, ms) => until(what, `${mainWin}.webContents.executeJavaScript(${JSON.stringify(js)})`, ms);
const shot = async (name, win = editor) => { await delay(900); const png = await ev(`${win}.webContents.capturePage().then((i) => i.toPNG().toString('base64'))`); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(png, 'base64')); };
const click = (sel) => inEd(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; e.click(); return true; })()`);
const setter = (sel, value) => `(() => { const e = document.querySelector('${sel}'); if (!e) return false; const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`;
const setValue = (sel, value) => inEd(setter(sel, value));
const value = (sel) => inEd(`document.querySelector('${sel}')?.value ?? null`);
const text = (sel) => inEd(`document.querySelector('${sel}')?.textContent ?? null`);
const mainText = (sel) => inMain(`document.querySelector('${sel}')?.textContent ?? null`);
const pickNext = (file) => ev(`(${E}.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(file)}] }), true)`);
const selectNode = async (id) => { await inEd(`(() => { const g = document.querySelector('[data-node-id="${id}"]'); for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) g?.dispatchEvent(new MouseEvent(t, { bubbles: true })); return 1; })()`); await untilEd(`panel of ${id}`, `document.querySelector('[data-ev=project-panel][data-node="${id}"]') !== null`); await delay(300); };
const selectGraph = async () => { await inEd(`(() => { const s = document.querySelector('svg.canvas, [data-ev=canvas] svg, svg'); for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) s?.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 5, clientY: 5 })); return 1; })()`); await delay(500); };
const levelText = (level) => `[data-ev=project-level-${level.replace(':', '-')}] textarea`;
const editLevel = async (level, textValue) => { await inEd(`(() => { const d = document.querySelector('[data-ev=project-level-${level.replace(':', '-')}]'); if (d) d.open = true; return 1; })()`); await setValue(levelText(level), textValue); await delay(700); };
const status = () => text('[data-ev=project-panel] [data-ev=project-draft-status-line]');
const sendChat = async (message) => {
  // Only when the last turn has ended, or the message would steer it instead.
  await untilMain('the chat is free', `(document.querySelector('textarea[data-ev=prompt]')?.placeholder ?? '').startsWith('Describe')`, 60000);
  await inMain(setter('textarea[data-ev=prompt]', message));
  await inMain(`(() => { const e = document.querySelector('textarea[data-ev=prompt]'); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return 1; })()`);
};
const tool = (name, args) => `[[tool ${name} ${JSON.stringify(args)}]]`;

async function openWorkspaceAndEditor() {
  await inMain(`window.dspatch.chooseAgent('claude')`);
  await inMain(`window.dspatch.openWorkspace(${JSON.stringify({ folder: project, provider: 'claude', newChat: true })}).then(() => 1)`).catch((e) => String(e));
  await delay(1500);
  // The chat itself, as a person opens it from the start page.
  await inMain('location.reload()').catch(() => 0);
  await delay(2500);
  await untilMain('the recent project', `document.querySelector('[data-ev=open-project-0]') !== null || document.querySelector('textarea[data-ev=prompt]') !== null`);
  await inMain(`document.querySelector('[data-ev=open-project-0]')?.click(), 1`);
  await untilMain('the chat', `document.querySelector('textarea[data-ev=prompt]') !== null`);
  await delay(1500);
  await inMain(`window.dspatch.openLoopEditor().then(() => 1)`);
  await until('editor', `Boolean(${editor})`);
  await ev(`${editor}.setContentSize(1500, 1000)`);
  await delay(3500);
}

try {
  await launch('a');
  await openWorkspaceAndEditor();
  // The project graph, applied through the host as the DSP-229 window does, with a first common rule.
  const applied = await inEd(`(async () => {
    const o = await window.dspatch.projectGraph({ kind: 'options' });
    const t = o.templates.find((x) => x.key.includes('generic-agent-network'));
    const a = await window.dspatch.projectGraph({ kind: 'apply', templateKey: t.key, repository: o.repositories[0].path, name: 'Orders workflow',
      instructions: { format: 'dspatch-project-instructions', formatVersion: 1, common: { text: 'SAVED-COMMON: follow AGENTS.md.', documents: [{ path: 'AGENTS.md', purpose: 'rules', when: 'before starting' }] }, roles: {}, nodes: {} } });
    return JSON.stringify(a);
  })()`);
  const definitionKey = JSON.parse(applied).definitionKey;
  check('a project graph to work on', typeof definitionKey === 'string', applied.slice(0, 200));
  await ev(`${editor}.webContents.reload()`);
  await delay(4000);
  const savedAtStart = fs.readFileSync(instructionsFile, 'utf8');

  // 1. The right panel for a Reviewer step.
  await selectNode('reviewer-readiness');
  const tags = await inEd(`[...document.querySelectorAll('[data-ev=project-panel] .project-level')].map((d) => d.dataset.level + '=' + d.querySelector('summary').textContent)`);
  check('the panel shows common, role and step levels, inherited ones marked', tags.length === 3 && /All agent nodes/.test(tags[0]) && /inherited by every agent node/.test(tags[0]) && /All nodes with this role · Plan reviewer \(plan-reviewer v1\)/.test(tags[1]) && /This node instance only/.test(tags[2]) && /this node/.test(tags[2]), tags);
  const roleScope = await text('[data-ev=project-level-role-plan-reviewer] [data-ev=project-level-scope]');
  check('the role level says whom an edit reaches', /Reaches all 3 nodes using Plan reviewer/.test(roleScope ?? ''), roleScope);
  check('the common level shows the saved rule as inherited', (await value(levelText('common'))) === 'SAVED-COMMON: follow AGENTS.md.');
  check('the generic role text is kept apart from the project section', (await inEd(`document.querySelector('.role-block') !== null && !document.querySelector('.role-block').contains(document.querySelector('[data-ev=project-panel]'))`)) === true);
  await editLevel('role:plan-reviewer', 'MANUAL-ROLE: check the change against docs/ARCHITECTURE.md.');
  await editLevel('node:reviewer-readiness', 'MANUAL-NODE-REVIEWER: final review only.');
  await delay(500);
  check('the status says what is unsaved and that the next run uses the saved version', /Unsaved changes in 2 levels/.test((await status()) ?? '') && /next run uses the saved version/.test((await status()) ?? ''), await status());
  const briefHeading = await inEd(`[...document.querySelectorAll('[data-ev=node-brief] dt')].map((d) => d.textContent).find((t) => /project/.test(t)) ?? ''`);
  check('the message preview says it shows unsaved changes', /preview of unsaved changes/.test(briefHeading), briefHeading);
  check('the panel preview is labelled as unsaved', /Preview of unsaved changes/.test((await text('[data-ev=project-panel-preview-label]')) ?? ''));
  check('editing saved nothing', fs.readFileSync(instructionsFile, 'utf8') === savedAtStart);
  await shot('01-panel-reviewer');
  // A role edit reaches the other Reviewer steps; a step edit only its own.
  await selectNode('reviewer-plan-gate');
  const gate = await text('[data-ev=project-panel-preview-text]');
  check('another step with the role gets the role edit, not the other step\'s', /MANUAL-ROLE/.test(gate) && !/MANUAL-NODE-REVIEWER/.test(gate), gate.slice(0, 400));
  await selectNode('implementer');
  const impl = await text('[data-ev=project-panel-preview-text]');
  check('a step with another role gets neither', !/MANUAL-ROLE/.test(impl) && !/MANUAL-NODE-REVIEWER/.test(impl) && /SAVED-COMMON/.test(impl), impl.slice(0, 300));

  // 2. The customization window edits the same draft.
  await click('[data-ev=project-panel-window]');
  await untilEd('the window', `document.querySelector('[data-ev=project-sections]') !== null`);
  await click('[data-ev=project-section-role-plan-reviewer]');
  await delay(400);
  check('the window shows the panel\'s unsaved role edit', (await value('[data-ev=project-text]')) === 'MANUAL-ROLE: check the change against docs/ARCHITECTURE.md.', await value('[data-ev=project-text]'));
  check('the window shows the same status', /Unsaved changes in 2 levels/.test((await text('[data-ev=project-window] [data-ev=project-draft-status-line]')) ?? ''));
  await click('[data-ev=project-section-common]');
  await setValue('[data-ev=project-text]', 'SAVED-COMMON: follow AGENTS.md. WINDOW-EDIT: say what you changed.');
  await delay(800);
  await shot('02-window-shared');
  await click('[data-ev=project-close]');
  await untilEd('window closed', `document.querySelector('[data-ev=project-window]') === null`);
  check('closing the window keeps its edit in the panel', /WINDOW-EDIT/.test((await value(levelText('common'))) ?? ''), await value(levelText('common')));
  check('the role edit is still there too', (await value(levelText('role:implementer'))) !== null && /Unsaved changes in 3 levels/.test((await status()) ?? ''), await status());

  // 3. Long text, documents and a narrow window.
  await editLevel('node:implementer', `MANUAL-NODE-IMPLEMENTER: ${'change only src/ and keep each commit small. '.repeat(30)}${'x'.repeat(240)}`);
  for (const file of ['AGENTS.md', 'docs/TESTING.md', 'docs/A-VERY-LONG-DOCUMENT-NAME-THAT-SHOULD-WRAP-IN-A-NARROW-PANEL-WITHOUT-SCROLLING.md']) {
    await pickNext(path.join(project, file));
    await inEd(`document.querySelector('[data-ev=project-level-node-implementer] [data-ev=project-level-document-pick]').click()`);
    await delay(600);
  }
  const docs = await inEd(`[...document.querySelectorAll('[data-ev=project-level-node-implementer] [data-ev=project-level-document] input[aria-label=Path]')].map((i) => i.value)`);
  check('documents chosen at the step level stay there', docs.length === 3 && docs[2].startsWith('docs/A-VERY-LONG'), docs);
  await ev(`${editor}.setContentSize(780, 900)`);
  await delay(1200);
  const overflow = await inEd(`(() => { const p = document.querySelector('[data-ev=project-panel]'); return { panel: p.scrollWidth - p.clientWidth, aside: p.closest('aside') ? p.closest('aside').scrollWidth - p.closest('aside').clientWidth : null }; })()`);
  check('long text and a long path fit a narrow window without sideways scrolling', overflow.panel <= 2 && (overflow.aside === null || overflow.aside <= 2), overflow);
  await shot('03-narrow-long');
  await ev(`${editor}.setContentSize(1500, 1000)`);
  await delay(800);

  // 4. Discuss in the main chat; the agent proposes; nothing is applied or saved by that.
  await selectNode('reviewer-readiness');
  await click('[data-ev=project-panel-discuss]');
  await untilMain('the chip', `document.querySelector('[data-ev=project-discussion-pending]') !== null`);
  const chip = await mainText('[data-ev=project-discussion-pending]');
  check('the main chat says what the next message carries', /Orders workflow · step Reviewer: reviewer-readiness/.test(chip) && /unsaved changes included/.test(chip), chip);
  const proposalChanges = JSON.stringify([
    { level: 'role:plan-reviewer', text: 'PROPOSED-ROLE: check against docs/ARCHITECTURE.md and that tests ran.', reason: 'Reviews missed untested changes.', sources: [{ path: '.github/agents/reviewer.agent.md', note: 'earlier VS Code agent definition; the test rule still holds' }] },
    { level: 'node:reviewer-readiness', documents: [{ path: 'docs/TESTING.md', purpose: 'how tests are run', when: 'before approving' }], reason: 'The final review checks test evidence.' },
  ]);
  await sendChat(`Look at the reviewer instructions. ${tool('read_project_instructions', { graph: 'orders-workflow', step: 'reviewer-readiness' })} ${tool('propose_project_instructions', { graph: 'orders-workflow', explanation: 'Add the test rule from the earlier agent definition.', changes: proposalChanges })}`);
  await untilMain('the proposal card', `document.querySelector('[data-ev=project-proposal-card]') !== null`, 30000);
  await delay(1500);
  const sentContext = await mainText('[data-ev$=project-context] pre');
  check('the message carried the draft, unsaved levels marked, and named the step and role', /UNSAVED in the draft/.test(sentContext ?? '') && /MANUAL-ROLE/.test(sentContext ?? '') && /In focus: the step "Reviewer: reviewer-readiness"/.test(sentContext ?? ''), (sentContext ?? '').slice(0, 300));
  check('documents were named, not attached', !/Always run the tests/.test(sentContext ?? ''));
  const card = await mainText('[data-ev=project-proposal-card]');
  check('the proposal says what changes, at which level, whom it reaches, why and from where', /Changes All nodes with this role/.test(card) && /reaches 3 steps/.test(card) && /Reviews missed untested changes/.test(card) && /reviewer\.agent\.md/.test(card) && /Changes This node instance only · Reviewer: reviewer-readiness — reaches 1 step/.test(card), card.slice(0, 500));
  check('the chip is gone after the message', (await inMain(`document.querySelector('[data-ev=project-discussion-pending]') === null`)) === true);
  check('proposing changed neither the draft nor the file', (await value(levelText('role:plan-reviewer'))) === 'MANUAL-ROLE: check the change against docs/ARCHITECTURE.md.' && fs.readFileSync(instructionsFile, 'utf8') === savedAtStart);
  await untilEd('the panel lists it', `document.querySelector('[data-ev=project-panel-proposals]') !== null`);
  await shot('04-chat-proposal', mainWin);
  // Apply in the chat: the draft changes, the file does not.
  await inMain(`document.querySelector('[data-ev=project-proposal-card] [data-ev=project-proposal-apply]').click()`);
  await untilMain('applied', `document.querySelector('[data-ev=project-proposal-card]')?.dataset.status === 'applied'`);
  await delay(800);
  check('applying updates the panel at once', /PROPOSED-ROLE/.test((await value(levelText('role:plan-reviewer'))) ?? ''), await value(levelText('role:plan-reviewer')));
  check('applying saved nothing', fs.readFileSync(instructionsFile, 'utf8') === savedAtStart);
  check('the chat card says it is applied to the draft, not saved', /Applied to the draft — not saved/.test((await mainText('[data-ev=project-proposal-card] [data-ev=project-proposal-status]')) ?? ''));

  // 5. A proposal made before a newer manual edit is not applied over it.
  await sendChat(tool('propose_project_instructions', { graph: 'orders-workflow', explanation: 'Shorter.', changes: JSON.stringify([{ level: 'role:plan-reviewer', text: 'SHORT-ROLE', reason: 'shorter' }]) }));
  try {
    await untilMain('second card', `document.querySelectorAll('[data-ev=project-proposal-card]').length === 2`, 30000);
  } catch (error) {
    console.log('MAIN TEXT', (await inMain('document.body.innerText')).slice(-2500));
    throw error;
  }
  await editLevel('role:plan-reviewer', 'MY-NEWER-ROLE-EDIT');
  await untilMain('stale shown', `document.querySelectorAll('[data-ev=project-proposal-card]')[1]?.querySelector('[data-ev=project-proposal-stale]') !== null`);
  check('a stale proposal says so and cannot be applied', (await inMain(`document.querySelectorAll('[data-ev=project-proposal-card]')[1].querySelector('[data-ev=project-proposal-apply]').disabled`)) === true);
  const forced = await inMain(`window.dspatch.projectGraph({ kind: 'proposalApply', definitionKey: ${JSON.stringify(definitionKey)}, proposalId: document.querySelectorAll('[data-ev=project-proposal-card]')[1].dataset.proposal }).then((a) => a.kind + ' ' + (a.problems ?? []).join(' '))`);
  check('the host refuses it too, keeping the newer edit', /^refused/.test(forced) && (await value(levelText('role:plan-reviewer'))) === 'MY-NEWER-ROLE-EDIT', forced);
  await shot('05-stale', mainWin);

  // 6. A change on disk while the draft has changes.
  const onDisk = JSON.parse(fs.readFileSync(instructionsFile, 'utf8'));
  onDisk.nodes = { ...onDisk.nodes, qa: { text: 'DISK-QA: written by a colleague.', documents: [] } };
  fs.writeFileSync(instructionsFile, `${JSON.stringify(onDisk, null, 2)}\n`);
  await inEd(`window.dispatchEvent(new Event('focus'))`);
  await untilEd('disk banner', `document.querySelector('[data-ev=project-panel] [data-ev=project-draft-disk-changed]') !== null`);
  check('Save is refused while the file on disk changed', (await inEd(`document.querySelector('[data-ev=project-panel] [data-ev=project-draft-save]').disabled`)) === true);
  await shot('06-disk-changed');
  await click('[data-ev=project-panel] [data-ev=project-draft-take-disk]');
  await untilEd('banner gone', `document.querySelector('[data-ev=project-panel] [data-ev=project-draft-disk-changed]') === null`);
  check('taking in the disk change keeps the person\'s levels', (await value(levelText('role:plan-reviewer'))) === 'MY-NEWER-ROLE-EDIT');
  // 7. Save, and the preview is what was saved.
  await selectNode('reviewer-readiness');
  const previewBefore = await text('[data-ev=project-panel-preview-text]');
  await click('[data-ev=project-panel] [data-ev=project-draft-save]');
  await untilEd('saved', `/Saved/.test(document.querySelector('[data-ev=project-panel] [data-ev=project-draft-status-line]')?.textContent ?? '')`);
  const savedFile = fs.readFileSync(instructionsFile, 'utf8');
  check('Save writes the draft, the colleague\'s level included', /MY-NEWER-ROLE-EDIT/.test(savedFile) && /DISK-QA/.test(savedFile) && /WINDOW-EDIT/.test(savedFile) && /TESTING\.md/.test(savedFile));
  check('after saving the preview is the saved version and unchanged', (await text('[data-ev=project-panel-preview-text]')) === previewBefore && /saved project instructions/.test((await text('[data-ev=project-panel-preview-label]')) ?? ''));
  // 8. Discard changes.
  await editLevel('node:reviewer-readiness', 'TO-BE-DISCARDED');
  await inEd(`(window.confirm = () => true, 1)`);
  await click('[data-ev=project-panel] [data-ev=project-draft-discard]');
  await untilEd('discarded', `/Saved/.test(document.querySelector('[data-ev=project-panel] [data-ev=project-draft-status-line]')?.textContent ?? '')`);
  check('Discard changes returns to the file', (await value(levelText('node:reviewer-readiness'))) !== 'TO-BE-DISCARDED' && fs.readFileSync(instructionsFile, 'utf8') === savedFile);

  // 9. A run with unsaved changes asks; Cancel starts nothing, "Run the saved version" keeps the draft.
  await editLevel('common', 'UNSAVED-AT-RUN-TIME');
  await ev(`(globalThis.__asked = [], ${E}.dialog.showMessageBox = async (o) => { globalThis.__asked.push(o); return { response: globalThis.__answer ?? 2 }; }, true)`);
  await ev(`(globalThis.__answer = 2, true)`);
  const cancelled = await inMain(`window.dspatch.startChatLoopRun({ runId: 'trial-run-1', mandate: 'nothing', definitionKey: ${JSON.stringify(definitionKey)} }).then((o) => JSON.stringify(o))`);
  const asked = await ev(`JSON.stringify(globalThis.__asked.map((o) => ({ m: o.message, b: o.buttons })))`);
  check('the run start asks about unsaved project instructions', /unsaved changes/.test(asked) && /Run the saved version/.test(asked), asked);
  check('Cancel starts nothing', /refused/.test(cancelled) && /Nothing was started/.test(cancelled), cancelled);
  await ev(`(globalThis.__answer = 1, true)`);
  // A run's start answers when the run ends, so it is started, looked at and cancelled.
  await inMain(`(window.__run = window.dspatch.startChatLoopRun({ runId: 'trial-run-2', mandate: 'Say hello and stop.', definitionKey: ${JSON.stringify(definitionKey)} }).then((o) => JSON.stringify(o), (e) => String(e)), 1)`);
  await delay(4000);
  const walking = await ev(`globalThis.__asked.length`);
  await inMain(`window.dspatch.cancelChatLoopRun().then(() => 1)`).catch(() => 0);
  const ran = await Promise.race([inMain(`window.__run`), delay(60000).then(() => 'still running after cancel')]);
  check('the run start asked again and the run was started', walking === 2, walking);
  const ranKind = (() => { try { return JSON.parse(ran).kind; } catch { return ran; } })();
  check('Run the saved version runs without saving the draft', ranKind !== 'refused' && ranKind !== 'failed' && fs.readFileSync(instructionsFile, 'utf8') === savedFile && /UNSAVED-AT-RUN-TIME/.test(await inEd(`window.dspatch.projectGraph({ kind: 'draft', definitionKey: ${JSON.stringify(definitionKey)} }).then((a) => a.view.draft.common.text + ' unsaved=' + a.view.unsaved.join(','))`)), ran.slice(0, 300));

  // 10. A built-in workflow offers Apply to repository… and is not changed from here.
  const builtIn = await inEd(`[...document.querySelectorAll('[data-ev=editor-loop-definition] option')].find((o) => /generic/i.test(o.value) && !o.value.includes('orders-kit'))?.value ?? ''`);
  await ev(`(${E}.dialog.showMessageBox = async () => ({ response: 0 }), true)`);
  // The cancelled run left the editor in its run view; back to editing first.
  await inEd(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back to editing')?.click(), 1`);
  await delay(1000);
  await setValue('[data-ev=editor-loop-definition]', builtIn);
  await delay(3000);
  await selectGraph();
  check('a built-in workflow shows the way to Apply to repository…', (await inEd(`document.querySelector('[data-ev=project-panel-template] [data-ev=project-panel-apply]') !== null`)) === true);
  await shot('07-template');
  child.kill();
  await delay(2500);

  // 11. After a restart the unsaved draft and the proposals are still there.
  await launch('b');
  await openWorkspaceAndEditor();
  const afterRestart = await inEd(`window.dspatch.projectGraph({ kind: 'draft', definitionKey: ${JSON.stringify(definitionKey)} }).then((a) => JSON.stringify({ unsaved: a.view.unsaved, common: a.view.draft.common.text, proposals: a.view.proposals.map((p) => p.status) }))`);
  check('a restart keeps the unsaved draft and the proposals with their status', /"unsaved":\["common"\]/.test(afterRestart) && /UNSAVED-AT-RUN-TIME/.test(afterRestart) && /applied/.test(afterRestart) && /stale/.test(afterRestart), afterRestart);
  check('nothing was committed', execFileSync('git', ['log', '--oneline'], { cwd: project, encoding: 'utf8' }).trim().split('\n').length === 1);

  // 12. DSP-231: the shared role in the node panel, a role change and what it does to role additions,
  // and the reviewable upgrade of an older graph with legacy roles.
  const K = JSON.stringify(definitionKey);
  const graphFile = path.join(project, '.dspatch/loops/orders-workflow.graph.json');
  await inEd(`window.dspatch.projectGraph({ kind: 'draftDiscard', definitionKey: ${K} }).then(() => 1)`);
  // After the restart the editor shows the last graph it had, the built-in one: back to the project graph.
  await ev(`(${E}.dialog.showMessageBox = async () => ({ response: 0 }), true)`);
  const ordersOption = await inEd(`[...document.querySelectorAll('[data-ev=editor-loop-definition] option')].find((o) => o.value.includes('orders-workflow.loop.json'))?.value ?? ''`);
  await setValue('[data-ev=editor-loop-definition]', ordersOption);
  await delay(3000);
  await selectNode('reviewer-readiness');
  const identity = await text('[data-ev=role-identity-line]');
  check('the node panel names the shared role, its identity, version and origin', /Plan reviewer · plan-reviewer v1 · DSpatch catalog/.test(identity ?? ''), identity);
  const sharing = await text('[data-ev=role-identity-scope]');
  check('it says which nodes share the role, and that they do not share a session', /3 nodes/.test(sharing ?? '') && /own session/.test(sharing ?? ''), sharing);
  const parts = await inEd(`[...document.querySelectorAll('[data-ev=node-brief] dt')].map((d) => d.textContent)`);
  check('the effective message shows the role, the project additions and the task as parts of their own', parts.some((t) => /role/i.test(t)) && parts.some((t) => /project/i.test(t)) && parts.length >= 3, parts);
  check('the role text in the panel is the shared role, not the node task', (await inEd(`document.querySelector('[data-ev=node-role-text]')?.textContent.includes('Review a plan in your own context') && !document.querySelector('[data-ev=node-role-text]')?.textContent.includes('carry-forward ledger')`)) === true);
  await shot('08-role-identity');
  // A role addition for the one Skeptic node, saved; then the node is given another role.
  await inEd(`window.dspatch.projectGraph({ kind: 'draftEdit', definitionKey: ${K}, edits: [{ level: 'role:skeptic', section: { text: 'SKEPTIC-RULE', documents: [] } }] }).then(() => window.dspatch.projectGraph({ kind: 'draftSave', definitionKey: ${K} })).then(() => 1)`);
  await selectNode('skeptic');
  const graphBefore = fs.readFileSync(graphFile, 'utf8');
  await click('[data-ev=role-change]');
  await untilEd('the role picker', `document.querySelector('[data-ev=role-picker]') !== null`);
  await inEd(`(document.querySelector('[data-ev=role-picker-option][data-role=verifier] button').click(), 1)`);
  await delay(1500);
  check('a role change shows at once and writes nothing yet', /Verifier · verifier v1/.test((await text('[data-ev=role-identity-line]')) ?? '') && fs.readFileSync(graphFile, 'utf8') === graphBefore, await text('[data-ev=role-identity-line]'));
  await inEd(`([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save' && !b.closest('[data-ev=project-panel]'))?.click(), 1)`);
  await delay(2000);
  check('saving the graph pins the new shared role', /"id": "verifier",\s*"version": 1/.test(fs.readFileSync(graphFile, 'utf8').split('"id": "skeptic"')[1] ?? ''));
  await inEd(`(window.dispatchEvent(new Event('focus')), 1)`);
  await untilEd('additions that reach no node', `document.querySelector('[data-ev=project-orphan][data-role=skeptic]') !== null`, 20000).catch(() => undefined);
  check('the role additions the change left behind are shown, not silently moved or dropped', (await inEd(`document.querySelector('[data-ev=project-orphan][data-role=skeptic]') !== null`)) === true);
  await shot('09-orphaned-additions');
  await setValue('[data-ev=project-orphan-target]', 'verifier');
  await click('[data-ev=project-orphan-move]');
  await delay(1200);
  const moved = await inEd(`window.dspatch.projectGraph({ kind: 'draft', definitionKey: ${K} }).then((a) => JSON.stringify({ unsaved: a.view.unsaved, verifier: a.view.draft.roles.verifier?.text ?? null, skeptic: a.view.draft.roles.skeptic ?? null }))`);
  check('moving them is an explicit, unsaved change of the draft', /SKEPTIC-RULE/.test(moved) && /"skeptic":null/.test(moved) && /role:verifier/.test(moved), moved);
  await inEd(`window.dspatch.projectGraph({ kind: 'draftSave', definitionKey: ${K} }).then(() => 1)`);
  check('saved, they follow the role they were moved to', /SKEPTIC-RULE/.test(JSON.parse(fs.readFileSync(instructionsFile, 'utf8')).roles.verifier?.text ?? ''));

  // An older project graph with legacy roles: it runs as it is, and the upgrade is shown before anything changes.
  const legacyRoles = path.join(project, '.dspatch/loops/roles/legacy');
  fs.mkdirSync(legacyRoles, { recursive: true });
  for (const file of ['project-work.role.md', 'project-check.role.md']) fs.copyFileSync(path.join(appDir, '..', 'docs/loop/roles/project', file), path.join(legacyRoles, file));
  const oldChat = JSON.parse(execFileSync('git', ['show', '1737fca:docs/loop/graphs/dspatch-chat-loop.graph.json'], { cwd: appDir, encoding: 'utf8' }));
  oldChat.id = 'legacy'; oldChat.name = 'Legacy workflow';
  for (const node of oldChat.nodes) if (node.role) node.role.source.path = `.dspatch/loops/roles/legacy/${path.basename(node.role.source.path)}`;
  const legacyGraph = path.join(project, '.dspatch/loops/legacy.graph.json');
  fs.writeFileSync(legacyGraph, JSON.stringify(oldChat, null, 2));
  fs.writeFileSync(path.join(project, '.dspatch/loops/legacy.loop.json'), JSON.stringify({ format: 'dspatch-loop-definition', formatVersion: 1, id: 'legacy', name: 'Legacy workflow', resourceRoot: '../..', graph: '.dspatch/loops/legacy.graph.json' }, null, 2));
  const legacyBefore = fs.readFileSync(legacyGraph, 'utf8');
  await ev(`${editor}.webContents.reload()`);
  await delay(4000);
  const legacyOption = await inEd(`[...document.querySelectorAll('[data-ev=editor-loop-definition] option')].find((o) => o.value.includes('legacy.loop.json'))?.value ?? ''`);
  await setValue('[data-ev=editor-loop-definition]', legacyOption);
  await delay(3000);
  await selectNode('work').catch(() => undefined);
  await untilEd('the legacy role', `document.querySelector('[data-ev=role-identity-line]') !== null`, 15000).catch(() => undefined);
  check('a legacy role is shown as a local, unversioned role, with the upgrade named', /local role, not versioned/.test((await text('[data-ev=role-identity-line]')) ?? '') && (await inEd(`document.querySelector('[data-ev=role-identity-legacy]') !== null`)) === true, await text('[data-ev=role-identity-line]'));
  // Nothing selected: a click on the canvas's own background (its svg carries data-mode).
  await inEd(`(() => { const s = document.querySelector('svg[data-mode]'); s?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 })); return 1; })()`);
  await delay(700);
  await untilEd('the upgrade', `document.querySelector('[data-ev=role-upgrade-open]') !== null`, 15000).catch(() => undefined);
  await click('[data-ev=role-upgrade-open]');
  await delay(800);
  const rows = await inEd(`[...document.querySelectorAll('[data-ev=role-upgrade-row]')].map((r) => r.textContent)`);
  check('the upgrade shows each node\'s mapping and what moves to it', rows.length === 2 && /project-work/.test(rows[0]) && /implementer/.test(rows[0]) && /no-subagent-delegation/.test(rows[0]) && /verifier/.test(rows[1]), rows);
  const files = await text('[data-ev=role-upgrade-files]');
  check('it says every file it would write', /legacy\.graph\.json/.test(files ?? ''), files);
  check('showing the upgrade wrote nothing', fs.readFileSync(legacyGraph, 'utf8') === legacyBefore);
  await ev(`${editor}.setContentSize(760, 900)`);
  await delay(800);
  check('the upgrade fits a narrow window without scrolling sideways', (await inEd(`(() => { const a = document.querySelector('aside'); return a ? a.scrollWidth <= a.clientWidth + 2 : true; })()`)) === true);
  await shot('10-upgrade-narrow');
  await ev(`${editor}.setContentSize(1500, 1000)`);
  await click('[data-ev=role-upgrade-apply]');
  await delay(3000);
  const upgraded = fs.readFileSync(legacyGraph, 'utf8');
  check('applying the upgrade pins the shared roles and keeps the requirements on the nodes', /"kind": "role-catalog"/.test(upgraded) && /no-subagent-delegation/.test(upgraded) && !/project-work\.role\.md/.test(upgraded));
  check('the upgraded graph loads on its own copies', fs.existsSync(path.join(project, '.dspatch/roles/implementer/v1.role.md')) && (await inEd(`document.querySelector('[data-ev=role-upgrade-open]') === null`)) === true);
} catch (error) {
  check('trial ran', false, String(error));
  try { await shot('failure'); await shot('failure-main', mainWin); } catch {}
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(results.every((r) => r.ok) ? `ALL PASSED: ${results.length}` : `FAILED: ${results.filter((r) => !r.ok).length} of ${results.length}`, out);
  child?.kill();
  setTimeout(() => process.exit(0), 1500);
}
