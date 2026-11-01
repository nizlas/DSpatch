import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Where a host package comes from (DSP-153). The client's own build says which packages belong to
 * it (`host-manifest.json`, with each SHA-256); the file may come from any of these, and is
 * accepted only if it matches:
 *
 * 1. `DSPATCH_HOST_PACKAGES`, a folder, for trials before any release exists;
 * 2. `<userData>/host-packages`, where a person can put one by hand and where a download lands;
 * 3. the GitHub release of this version, fetched here. The remote machine never needs to reach
 *    GitHub: the client sends the package over SSH.
 */

export interface HostManifest {
  readonly hostId: string;
  readonly appVersion: string;
  readonly commit: string;
  readonly packages: readonly { readonly platform: string; readonly arch: string; readonly file: string; readonly sha256: string; readonly size: number }[];
}

export interface HostPackage {
  readonly hostId: string;
  readonly file: string;
  readonly path: string;
  readonly sha256: string;
}

export function readHostManifest(file: string): HostManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as HostManifest;
  } catch {
    return null;
  }
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'));
      });
  });
}

/** How long a download may take; a stalled one must end in a sentence, not a waiting window. */
const FETCH_MS = 15 * 60_000;

/** The release of exactly this version, prerelease or not: never `latest`. Publishes nothing. */
export function releaseUrl(appVersion: string, file: string): string {
  return `https://github.com/nizlas/DSpatch/releases/download/v${appVersion}/${file}`;
}

export async function findHostPackage(input: {
  readonly manifest: HostManifest | null;
  readonly platform: string;
  readonly arch: string;
  readonly folders: readonly string[];
  readonly cacheDir: string;
  readonly status: (text: string) => void;
  readonly log?: (message: string) => void;
  readonly fetchFile?: (url: string) => Promise<Buffer>;
}): Promise<HostPackage | string> {
  const { manifest } = input;
  if (manifest === null) {
    return 'This DSpatch was built without host packages, so it cannot install a host.';
  }
  const entry = manifest.packages.find((candidate) => candidate.platform === input.platform && candidate.arch === input.arch);
  if (entry === undefined) {
    return `This DSpatch has no host package for ${input.platform}-${input.arch}.`;
  }
  const found = { hostId: manifest.hostId, file: entry.file, sha256: entry.sha256 };
  let wrong = false;
  for (const folder of input.folders) {
    const candidate = path.join(folder, entry.file);
    if (fs.existsSync(candidate)) {
      if ((await sha256Of(candidate)) === entry.sha256) {
        return { ...found, path: candidate };
      }
      wrong = true;
    }
  }
  const url = releaseUrl(manifest.appVersion, entry.file);
  input.status('Fetching host…');
  try {
    const fetched =
      input.fetchFile === undefined
        ? await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) }).then(async (response) => {
            if (!response.ok) {
              throw new Error(String(response.status));
            }
            return Buffer.from(await response.arrayBuffer());
          })
        : await input.fetchFile(url);
    if (createHash('sha256').update(fetched).digest('hex') !== entry.sha256) {
      return 'The host package that was downloaded does not match this DSpatch, so it was not used. Connect to try again.';
    }
    fs.mkdirSync(input.cacheDir, { recursive: true });
    const target = path.join(input.cacheDir, entry.file);
    fs.writeFileSync(`${target}.part`, fetched);
    fs.renameSync(`${target}.part`, target);
    return { ...found, path: target };
  } catch (error) {
    input.log?.(`Fetching ${url}${wrong ? ' after a local copy did not match' : ''} failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'The host package could not be downloaded from GitHub. Check the network connection and connect again.';
  }
}
