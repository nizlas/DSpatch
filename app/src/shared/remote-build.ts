import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_HOST_METHOD_NAMES } from './project-host-contract';
import { REMOTE_PROTOCOL_VERSION, type RemoteBuild } from './remote-protocol';

/** This build, as the two sides of a remote connection compare it (DSP-111). */
export function remoteBuild(appPath: string): RemoteBuild {
  let appVersion = '0.0.0';
  let commit = 'unknown';
  try {
    appVersion = (JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8')) as { version?: string }).version ?? appVersion;
  } catch {
    // Unknown version; the contract digest is what decides.
  }
  try {
    const identity = JSON.parse(fs.readFileSync(path.join(appPath, 'dist', 'build-identity.json'), 'utf8')) as { git?: { revision?: string | null } };
    commit = identity.git?.revision?.slice(0, 12) ?? commit;
  } catch {
    // A build without an identity file.
  }
  const contract = createHash('sha256').update([...PROJECT_HOST_METHOD_NAMES].sort().join('\n')).digest('hex').slice(0, 16);
  const protocol = Number(process.env['DSPATCH_REMOTE_PROTOCOL_FOR_TEST'] ?? REMOTE_PROTOCOL_VERSION);
  return { protocol, contract, appVersion, commit };
}
