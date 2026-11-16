/**
 * The Help guides (DSP-211) are Markdown built into the renderer. What a later edit could break
 * without a window: that the guide still parses into the code blocks people copy, that every
 * shell it names is said, and that it carries placeholders rather than anyone's real values.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseMarkdown, type MarkdownBlock } from '../src/shared/markdown';

const helpDir = path.join(import.meta.dirname, '..', 'src', 'renderer', 'help');
const guide = fs.readFileSync(path.join(helpDir, 'remote-windows-host.md'), 'utf8');
/** The guide's other views (DSP-215), by name: `remote-windows-host.<view>.md`. */
const views = Object.fromEntries(
  fs.readdirSync(helpDir)
    .filter((name) => /^remote-windows-host\.[a-z-]+\.md$/.test(name))
    .map((name) => [name.split('.')[1] ?? '', fs.readFileSync(path.join(helpDir, name), 'utf8')]),
);
const everything = [guide, ...Object.values(views)].join('\n');

function codeBlocks(blocks: readonly MarkdownBlock[]): { language: string | null; text: string }[] {
  return blocks.flatMap((block) =>
    block.kind === 'code' ? [{ language: block.language, text: block.text }] : block.kind === 'list' ? block.items.flatMap((item) => codeBlocks(item.blocks)) : block.kind === 'quote' ? codeBlocks(block.blocks) : [],
  );
}

test('the guide opens on three steps only, each at the computer it names (DSP-215)', () => {
  const headings = guide.split('\n').filter((line) => line.startsWith('## '));
  assert.deepEqual(headings, [
    '## 1. Linux: run the helper',
    '## 2. Windows: run that command as administrator',
    '## 3. Linux: check the fingerprint, then connect',
  ]);
  const code = codeBlocks(parseMarkdown(guide));
  assert.equal(code.length, 2, 'two commands to copy: the helper and ssh');
  assert.ok(code[0]?.language === 'bash' && code[0].text.includes('/opt/DSpatch/resources/bundled/remote-setup/dspatch-prepare-linux-client.sh <windows-user>@<windows-host>'));
  assert.ok(code[1]?.language === 'bash' && code[1].text === 'ssh <windows-user>@<windows-host>');
  const step2 = guide.slice(guide.indexOf('## 2.'), guide.indexOf('## 3.'));
  assert.match(step2, /PowerShell as administrator/);
  const step3 = guide.slice(guide.indexOf('## 3.'));
  assert.match(step3, /fingerprint/);
  assert.match(step3, /Remote Session/);
  assert.ok(guide.length < 2500, `the steps are short: ${String(guide.length)} characters`);
  assert.doesNotMatch(guide, /-DryRun|Set-ExecutionPolicy|Manual|Troubleshooting|icacls|sshd_config/, 'no alternatives or internals in the steps');
});

test('every other view is a file the Help window shows behind a link', () => {
  assert.deepEqual(Object.keys(views).sort(), ['how-it-works', 'manual', 'other-ways', 'tested', 'troubleshooting']);
  const window = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'renderer', 'HelpWindow.tsx'), 'utf8');
  for (const view of Object.keys(views)) {
    assert.ok(window.includes(`'./help/remote-windows-host.${view}.md?raw'`), `HelpWindow imports ${view}`);
    assert.ok(window.includes(`id: '${view}'`), `HelpWindow offers ${view}`);
  }
  assert.match(window, /id: 'other-ways'[^\n]*savesScripts: true/, 'the save buttons are on the other ways');
});

test('the views parse into copyable commands, each in a named shell', () => {
  const code = codeBlocks(parseMarkdown(everything));
  for (const block of code) {
    assert.ok(block.language === 'powershell' || block.language === 'bash', `a block without its shell: ${block.text.slice(0, 60)}`);
  }
  const manual = codeBlocks(parseMarkdown(views.manual ?? ''));
  assert.ok(manual.some((block) => block.text.includes('Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0')));
  assert.ok(manual.some((block) => block.text.includes('administrators_authorized_keys') && block.text.includes('/inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F"')));
  assert.ok(manual.some((block) => block.text.includes('-RemoteAddress') && block.text.includes('-InterfaceAlias')));
  assert.ok(manual.some((block) => block.text.includes('whoami /groups') && block.text.includes('S-1-5-32-544')));
  assert.doesNotMatch(code.map((block) => block.text).join('\n'), /IsInRole/, 'no IsInRole as an administrator check');
  const other = codeBlocks(parseMarkdown(views['other-ways'] ?? ''));
  assert.ok(other.some((block) => block.text.includes('https://github.com/nizlas/DSpatch/releases/download/v{{version}}/dspatch-prepare-windows-host.ps1')));
  assert.ok(other.some((block) => block.text.includes('releases/download/v{{version}}/SHA256SUMS') && block.text.includes('Get-FileHash')));
});

test('the guide carries placeholders, not anyone\'s address, account or key', () => {
  assert.doesNotMatch(everything.replaceAll('~~~~0.0.1.0', ''), /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'no IPv4 address (the capability names end in 0.0.1.0)');
  assert.doesNotMatch(everything, /ssh-(?:ed25519|rsa) AAAA/, 'no public key');
  assert.match(guide, /<windows-user>@<windows-host>/);
  assert.match(everything, /<linux-client-ip>/);
});
