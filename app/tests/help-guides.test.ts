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

const guide = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'renderer', 'help', 'remote-windows-host.md'), 'utf8');

function codeBlocks(blocks: readonly MarkdownBlock[]): { language: string | null; text: string }[] {
  return blocks.flatMap((block) =>
    block.kind === 'code' ? [{ language: block.language, text: block.text }] : block.kind === 'list' ? block.items.flatMap((item) => codeBlocks(item.blocks)) : block.kind === 'quote' ? codeBlocks(block.blocks) : [],
  );
}

test('the Windows-host guide parses into copyable commands, each in a named shell', () => {
  const code = codeBlocks(parseMarkdown(guide));
  assert.ok(code.length >= 15, `code blocks: ${String(code.length)}`);
  for (const block of code) {
    assert.ok(block.language === 'powershell' || block.language === 'bash', `a block without its shell: ${block.text.slice(0, 60)}`);
  }
  assert.ok(code.some((block) => block.text.includes('Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0')));
  assert.ok(code.some((block) => block.text.includes('administrators_authorized_keys') && block.text.includes('/inheritance:r')));
  assert.ok(code.some((block) => block.text.includes('-RemoteAddress') && block.text.includes('-InterfaceAlias')));
});

test('the guide starts with the scripts, and its manual part checks by SID (DSP-214)', () => {
  const code = codeBlocks(parseMarkdown(guide));
  assert.ok(guide.indexOf('## The short way') < guide.indexOf('## Manual setup (reference)'), 'the short way comes first');
  assert.ok(guide.indexOf('## Manual setup (reference)') < guide.indexOf('## Troubleshooting'));
  assert.ok(code.some((block) => block.language === 'bash' && block.text.includes('/opt/DSpatch/resources/bundled/remote-setup/dspatch-prepare-linux-client.sh')));
  assert.ok(code.some((block) => block.text.includes('https://github.com/nizlas/DSpatch/releases/download/v{{version}}/dspatch-prepare-windows-host.ps1')));
  assert.ok(code.some((block) => block.text.includes('releases/download/v{{version}}/SHA256SUMS') && block.text.includes('Get-FileHash')));
  assert.ok(code.some((block) => block.text.includes('Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass')));
  assert.ok(code.some((block) => block.text.includes('whoami /groups') && block.text.includes('S-1-5-32-544')));
  assert.doesNotMatch(code.map((block) => block.text).join('\n'), /IsInRole/, 'no IsInRole as an administrator check');
  assert.ok(code.some((block) => block.text.includes('/inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F"')));
});

test('the guide carries placeholders, not anyone\'s address, account or key', () => {
  assert.doesNotMatch(guide.replaceAll('~~~~0.0.1.0', ''), /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'no IPv4 address (the capability names end in 0.0.1.0)');
  assert.doesNotMatch(guide, /ssh-(?:ed25519|rsa) AAAA/, 'no public key');
  assert.match(guide, /<windows-user>@<windows-host>/);
  assert.match(guide, /<linux-client-ip>/);
});
