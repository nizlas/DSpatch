// An Electron client with a DevTools port that starts a child the way DSpatch starts its local
// host, then quits (DSP-165.1). Run: electron devtools-client.cjs --remote-debugging-port=<port>
// <spawn|shell> <out folder>. `spawn` is Node's start, `shell` the one `windowsHostStart` builds.
// It writes `client.json` with both process ids; the child writes `child.json` and lives on.
const { app } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mode = process.argv.at(-2);
const out = process.argv.at(-1);
// No double quote in it: `windowsHostStart` refuses what it cannot quote for cmd.
const record = path.join(out, 'child.json').replaceAll('\\', '/');
const child = ['-e', `require('fs').writeFileSync('${record}', JSON.stringify({ pid: process.pid })); setInterval(() => undefined, 1000);`];

app.whenReady().then(() => {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (mode === 'spawn') {
    spawn(process.execPath, child, { env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    const { windowsHostStart } = require(path.join(__dirname, '..', '..', 'dist', 'main', 'local-host.js'));
    const start = windowsHostStart(process.execPath, child, path.join(out, 'child.log'), out);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(start.script, 'utf16le').toString('base64')], { env: { ...env, ...start.env }, windowsHide: true });
  }
  fs.writeFileSync(path.join(out, 'client.json'), JSON.stringify({ client: process.pid }));
  setTimeout(() => app.quit(), 1000);
});
