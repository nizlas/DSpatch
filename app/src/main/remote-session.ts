import fs from 'node:fs';
import path from 'node:path';

import { REMOTE_DEFAULT_PORT } from '../shared/remote-protocol';
import type { RemoteEndpoint } from './remote-link';

/*
 * Which host this client uses (DSP-111). `remote-session.json` in the client's own data holds
 * the address and the token, readable by this user only; it is what the Remote Session button
 * writes. `DSPATCH_REMOTE` (with `DSPATCH_REMOTE_TOKEN_FILE`) overrides it for one launch.
 */

const FILE = 'remote-session.json';

/** `host:port` or `port`. Only a loopback address: a host is reached through a tunnel. */
export function parseRemoteAddress(text: string): { readonly host: string; readonly port: number } | { readonly error: string } {
  const value = text.trim();
  const match = /^(?:(127\.0\.0\.1|localhost):)?(\d{1,5})$/.exec(value) ?? (value === '' ? [value, undefined, String(REMOTE_DEFAULT_PORT)] : null);
  const port = Number(match?.[2]);
  if (match === null || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Give the local end of the SSH tunnel: a port, or 127.0.0.1 and a port. A host is never reached directly over a network.' };
  }
  return { host: match[1] ?? '127.0.0.1', port };
}

export function readRemoteSession(userDataDir: string, env: Readonly<Record<string, string | undefined>>): RemoteEndpoint | null {
  const wanted = env['DSPATCH_REMOTE'];
  if (wanted !== undefined && wanted !== '') {
    const address = parseRemoteAddress(wanted);
    const tokenFile = env['DSPATCH_REMOTE_TOKEN_FILE'];
    if ('error' in address || tokenFile === undefined) {
      throw new Error('DSPATCH_REMOTE needs a loopback address, and DSPATCH_REMOTE_TOKEN_FILE the file holding the token.');
    }
    return { ...address, token: fs.readFileSync(tokenFile, 'utf8').trim() };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, FILE), 'utf8')) as { active?: unknown; address?: unknown; token?: unknown };
    if (saved.active !== true || typeof saved.address !== 'string' || typeof saved.token !== 'string') {
      return null;
    }
    const address = parseRemoteAddress(saved.address);
    return 'error' in address ? null : { ...address, token: saved.token };
  } catch {
    return null;
  }
}

export function saveRemoteSession(userDataDir: string, address: string, token: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, FILE), `${JSON.stringify({ active: true, address, token }, null, 2)}\n`, { mode: 0o600 });
}

/** Leave the session; the address stays out of the file along with the token. */
export function endRemoteSession(userDataDir: string): void {
  fs.rmSync(path.join(userDataDir, FILE), { force: true });
}
