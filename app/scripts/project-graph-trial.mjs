// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * DSP-229 window trial: Apply to repository…, the customization window, recommendations, saving,
 * reopening and workspace scoping. This checkout's build (npm run build), headless Electron, an
 * isolated profile, the presentation adapter (SIMULATED: no model is called). The native file
 * chooser is answered by replacing dialog.showOpenDialog in the main process with the file a person
 * would pick; everything after it is the product's own path.
 *
 *     node scripts/project-graph-trial.mjs [<evidence folder>]
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const kit = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-project-graph'));
const out = path.join(kit, `run-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, 'profile');
// The synthetic project, and a second repository for another workspace.
const project = path.join(out, 'orders-kit');
const other = path.join(out, 'other-repo');
for (const dir of [project, other]) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
}
fs.mkdirSync(path.join(project, 'tools'), { recursive: true });
fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Rules\nAlways run the tests.\n');
fs.writeFileSync(path.join(project, 'docs/ARCHITECTURE.md'), '# Architecture\n');
fs.writeFileSync(path.join(project, 'docs/TESTING.md'), '# Testing\n');
fs.writeFileSync(path.join(project, 'tools/RELEASE.md'), '# Releasing\n');
for (const dir of [project, other]) {
  const g = (...a) => execFileSync('git', a, { cwd: dir });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@l'); g('config', 'commit.gpgsign', 'false'); g('add', '.'); g('commit', '-qm', 'first');
}
const genericBefore = fs.readFileSync(path.join(appDir, '..', 'docs/loop/graphs/generic-agent-network.graph.json'), 'utf8');
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
const shot = async (name) => { await delay(900); const png = await ev(`${editor}.webContents.capturePage().then((i) => i.toPNG().toString('base64'))`); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(png, 'base64')); };
const click = (sel) => inEd(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; e.click(); return true; })()`);
const setValue = (sel, value) => inEd(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
const text = (sel) => inEd(`document.querySelector('${sel}')?.innerText ?? null`);
const pickNext = (file) => ev(`(${E}.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(file)}] }), true)`);
async function openEditorOn(folder) {
  await inMain(`window.dspatch.chooseAgent('claude')`);
  await inMain(`window.dspatch.openWorkspace(${JSON.stringify({ folder, provider: 'claude', newChat: true })}).then(() => 1)`).catch((e) => String(e));
  await delay(2500);
  await inMain(`window.dspatch.openLoopEditor().then(() => 1)`);
  await until('editor', `Boolean(${editor})`);
  await ev(`${editor}.setContentSize(1500, 1000)`);
  await delay(3500);
}
const listing = () => inMain(`window.dspatch.listLoopDefinitions().then((l) => JSON.stringify(l.choices.map((c) => ({ key: c.key, name: c.display.name, group: c.display.group, owner: c.display.owner, pre: c.preselected, project: c.display.projectInstructions }))))`).then(JSON.parse);
try {
  await launch('apply');
  await openEditorOn(project);
  // Apply to repository…
  check('the chooser lists built-in workflows as their own group', (await inEd(`[...document.querySelectorAll('[data-ev=editor-loop-definition] optgroup')].map((g) => g.label).join('|')`)) .includes('Built-in workflows'));
  await click('[data-ev=apply-to-repository]');
  await until('the window', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-setup]") !== null')`);
  await until('templates', `${editor}.webContents.executeJavaScript('document.querySelectorAll("[data-ev=project-template] option").length > 0')`);
  const templates = await inEd(`[...document.querySelectorAll('[data-ev=project-template] option')].map((o) => o.value)`);
  const generic = templates.find((t) => t.includes('generic-agent-network'));
  await setValue('[data-ev=project-template]', generic);
  await setValue('[data-ev=project-name]', 'Orders workflow');
  await shot('01-apply-setup');
  await click('[data-ev=project-next]');
  await until('the sections', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-sections]") !== null')`);
  // Common: text, and AGENTS.md through the file chooser.
  await setValue('[data-ev=project-text]', 'MANUAL-COMMON: follow the repository rules.');
  await pickNext(path.join(project, 'AGENTS.md'));
  await click('[data-ev=project-document-pick]');
  await delay(500);
  const commonDocs = await inEd(`[...document.querySelectorAll('[data-ev=project-document] input[aria-label=Path]')].map((i) => i.value)`);
  check('a document chosen with the file chooser is kept relative to the repository', JSON.stringify(commonDocs) === JSON.stringify(['AGENTS.md']), commonDocs);
  await setValue('[data-ev=project-document] input[aria-label="Why it matters"]', 'the project rules');
  await setValue('[data-ev=project-document] input[aria-label="When to read it"]', 'before starting');
  // A document outside the repository is marked so.
  await pickNext('/etc/hostname');
  await click('[data-ev=project-document-pick]');
  await delay(400);
  check('a document outside the repository is marked, not copied', (await text('[data-ev=project-documents]'))?.includes('outside the repository'), await text('[data-ev=project-documents]'));
  await inEd(`(() => { const b = [...document.querySelectorAll('[data-ev=project-document-remove]')]; b[b.length - 1].click(); return b.length; })()`);
  await delay(300);
  // The role the implementer step and the parallel branches share, then each of them.
  await click('[data-ev=project-section-role-generic-implementer]');
  await setValue('[data-ev=project-text]', 'MANUAL-ROLE: run the tests in docs/TESTING.md.');
  const users = await text('[data-ev=project-section-role-users]');
  check('the role section names every step that shares it', /Implementer/.test(users ?? '') && /Parallel/.test(users ?? ''), users);
  await click('[data-ev=project-section-node-implementer]');
  await setValue('[data-ev=project-text]', 'MANUAL-NODE-IMPLEMENTER: change only src/.');
  await pickNext(path.join(project, 'docs/ARCHITECTURE.md'));
  await click('[data-ev=project-document-pick]');
  await click('[data-ev=project-section-node-branches]');
  await setValue('[data-ev=project-text]', 'MANUAL-NODE-BRANCHES: keep to your slice.');
  await pickNext(path.join(project, 'tools/RELEASE.md'));
  await click('[data-ev=project-document-pick]');
  // Recommendations: simulated agent, for all, then for this step.
  await click('[data-ev=project-recommend-all]');
  await until('proposals', `${editor}.webContents.executeJavaScript('document.querySelectorAll("[data-ev=project-proposal]").length > 0')`, 30000);
  const branchesText = await inEd(`document.querySelector('[data-ev=project-text]').value`);
  check('recommendations leave the person\'s text as it was', branchesText === 'MANUAL-NODE-BRANCHES: keep to your slice.', branchesText);
  await shot('02-recommendations');
  await click('[data-ev=project-recommend-step]');
  await delay(2500);
  const reused = await text('[data-ev=project-proposals-missing-information]');
  check('a step\'s recommendation reuses the inventory', /reused/.test(reused ?? ''), reused);
  // Take one document proposal for the common section.
  await click('[data-ev=project-section-common]');
  await click('[data-ev=project-recommend-all]');
  await until('proposals again', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-proposal][data-target=common]") !== null')`, 30000);
  const takenBefore = await inEd(`[...document.querySelectorAll('[data-ev=project-proposal][data-target=common] [data-ev=project-take-document]')].map((b) => b.textContent)`);
  await inEd(`(() => { const b = document.querySelector('[data-ev=project-proposal][data-target=common] [data-ev=project-take-append]'); b?.click(); return Boolean(b); })()`);
  const commonAfter = await inEd(`document.querySelector('[data-ev=project-text]').value`);
  check('taking a proposal adds it after the person\'s own text', commonAfter.startsWith('MANUAL-COMMON') && /SIMULATED/.test(commonAfter), { takenBefore, commonAfter });
  // The preview of the implementer step.
  await click('[data-ev=project-section-node-implementer]');
  await delay(400);
  const preview = await text('[data-ev=project-preview-text]');
  check('the preview of a step shows common, role and step in order, documents pointed at', preview.indexOf('MANUAL-COMMON') < preview.indexOf('MANUAL-ROLE') && preview.indexOf('MANUAL-ROLE') < preview.indexOf('MANUAL-NODE-IMPLEMENTER') && /- AGENTS\.md/.test(preview) && !/MANUAL-NODE-BRANCHES/.test(preview), preview);
  await shot('03-step-preview');
  // Review and save.
  await click('[data-ev=project-review-files]');
  await until('files', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-files]") !== null')`);
  const files = await text('[data-ev=project-files]');
  check('the files are listed before saving', /orders-workflow\.loop\.json/.test(files) && /roles\/orders-workflow\//.test(files) && /orders-workflow\.project\.json/.test(files), files.slice(0, 400));
  check('nothing was written before Save', !fs.existsSync(path.join(project, '.dspatch')));
  await shot('04-review-files');
  await click('[data-ev=project-save]');
  await until('closed', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-window]") === null')`, 20000);
  await delay(2500);
  const after = await listing();
  const mine = after.find((row) => row.name === 'Orders workflow');
  check('the project graph is listed under Project workflows and chosen for this workspace', mine?.group === 'project' && mine.pre === true && mine.project === true, mine);
  check('the bundled template is unchanged', fs.readFileSync(path.join(appDir, '..', 'docs/loop/graphs/generic-agent-network.graph.json'), 'utf8') === genericBefore);
  check('nothing was committed', execFileSync('git', ['status', '--short'], { cwd: project, encoding: 'utf8' }).includes('.dspatch/'));
  check('Project instructions… is offered for it', (await inEd(`document.querySelector('[data-ev=project-instructions]') !== null`)) === true);
  // The editor's node panel shows what the implementer step gets.
  await inEd(`(() => { const g = document.querySelector('[data-node-id="implementer"]'); for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) g?.dispatchEvent(new MouseEvent(t, { bubbles: true })); return 1; })()`);
  await delay(1200);
  const brief = await inEd(`document.querySelector('[data-ev=node-brief-project-text]')?.innerText ?? ''`);
  check('the node panel shows the project\'s instructions for the step, as the run assembles them', /MANUAL-NODE-IMPLEMENTER/.test(brief) && /MANUAL-ROLE/.test(brief), brief.slice(0, 300));
  await shot('05-node-panel');
  child.kill();
  await delay(2500);
  // Reopen: the saved instructions are there.
  await launch('reopen');
  await openEditorOn(project);
  const again = await listing();
  check('after a restart the project graph is still this workspace\'s choice', again.find((row) => row.name === 'Orders workflow')?.pre === true, again.map((r) => [r.name, r.pre]));
  await click('[data-ev=project-instructions]');
  await until('the window again', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-sections]") !== null')`);
  const reopenedCommon = await inEd(`document.querySelector('[data-ev=project-text]').value`);
  check('saved instructions survive closing and reopening', reopenedCommon.startsWith('MANUAL-COMMON'), reopenedCommon.slice(0, 120));
  await click('[data-ev=project-section-node-branches]');
  await setValue('[data-ev=project-text]', 'MANUAL-NODE-BRANCHES: keep to your slice. EDITED');
  await click('[data-ev=project-review-files]');
  await until('review', `${editor}.webContents.executeJavaScript('document.querySelector("[data-ev=project-files]") !== null')`);
  check('maintaining changes one file', /orders-workflow\.project\.json/.test(await text('[data-ev=project-files]')));
  await click('[data-ev=project-save]');
  await delay(1200);
  const savedFile = fs.readFileSync(path.join(project, '.dspatch/loops/orders-workflow.project.json'), 'utf8');
  check('the edit is saved', /EDITED/.test(savedFile));
  await shot('06-maintain');
  await click('[data-ev=project-close]');
  child.kill();
  await delay(2500);
  // Another workspace: the project graph is not offered there.
  await launch('other');
  await openEditorOn(other);
  const elsewhere = await listing();
  check('another workspace does not list the project graph', !elsewhere.some((row) => row.name === 'Orders workflow'), elsewhere.map((r) => r.name));
} catch (error) {
  check('trial ran', false, String(error));
  try { await shot('failure'); } catch {}
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(results.every((r) => r.ok) ? `ALL PASSED: ${results.length}` : `FAILED: ${results.filter((r) => !r.ok).length} of ${results.length}`, out);
  child?.kill();
  setTimeout(() => process.exit(0), 1500);
}
