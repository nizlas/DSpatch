import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A synthetic runtime home with `preToolUse` and `postToolUse` command hooks, for the Copilot
 * runtime's real hook execution. The hooks are a Bash and a PowerShell script, each handing
 * over to one Node check, which writes a line per invocation and answers as the test said.
 *
 * Nothing here is, or is modelled on, any organisation's scripts or rules.
 */

/** In a file the rule excludes; must never reach the stand-in model where a test says so. */
export const EXCLUDED_MARKER = 'EXCLUDED-SYNTHETIC-MARKER-5e1c';

export interface HookBehaviour {
  /** Deny a call whose path or command matches this regular expression, unanchored. */
  readonly denyMatching?: string;
  /** After a tool: replace a result containing this text, before the model gets it. */
  readonly replaceResultContaining?: string;
  /** Written to standard output, unless a denial answered. */
  readonly stdout?: string;
  readonly exit?: number;
  readonly sleepMs?: number;
  /** Sleep only for a call whose path or command matches this regular expression. */
  readonly sleepMatching?: string;
}

export interface HookBehaviours {
  readonly pre?: HookBehaviour;
  readonly post?: HookBehaviour;
}

export interface HookInvocation {
  readonly kind: 'pre' | 'post';
  readonly atMs: number;
  readonly pid: number;
  readonly cwd: string;
  readonly input: {
    readonly cwd: string;
    readonly toolName: string;
    readonly toolArgs: Readonly<Record<string, unknown>>;
    readonly toolResult?: { readonly resultType: string; readonly textResultForLlm: string };
  };
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export interface HookFixture {
  /** `COPILOT_HOME` for the runtime. */
  readonly home: string;
  /** Hook runs so far, in order. */
  invocations(): HookInvocation[];
  /** The hook processes that lived through their sleep. */
  slept(): number[];
  behave(behaviours: HookBehaviours): void;
  clear(): void;
  remove(): void;
}

const CHECK = `import fs from 'node:fs';
const [, , kind, folder] = process.argv;
let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
}
const input = JSON.parse(text);
const behaviour = JSON.parse(fs.readFileSync(folder + '/behaviour.json', 'utf8'))[kind] ?? {};
const environment = Object.fromEntries(['COPILOT_HOME', 'COPILOT_HOOK_DIR', 'COPILOT_PROJECT_DIR', 'COPILOT_CLI'].map((name) => [name, process.env[name]]));
fs.appendFileSync(folder + '/invocations.jsonl', JSON.stringify({ kind, atMs: Date.now(), pid: process.pid, cwd: process.cwd(), input, environment }) + '\\n');
if (behaviour.sleepMs && (!behaviour.sleepMatching || new RegExp(behaviour.sleepMatching).test(JSON.stringify(input.toolArgs).replaceAll('\\\\\\\\', '/')))) {
  await new Promise((resolve) => setTimeout(resolve, behaviour.sleepMs));
  fs.appendFileSync(folder + '/slept.log', process.pid + '\\n');
}
if (behaviour.denyMatching && new RegExp(behaviour.denyMatching).test(JSON.stringify(input.toolArgs).replaceAll('\\\\\\\\', '/'))) {
  process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: 'The synthetic rule excludes this path.' }));
  process.exit(0);
}
if (behaviour.replaceResultContaining && JSON.stringify(input.toolResult).includes(behaviour.replaceResultContaining)) {
  process.stdout.write(JSON.stringify({ modifiedResult: { resultType: 'failure', textResultForLlm: 'The synthetic rule removed this result.' } }));
  process.exit(0);
}
if (behaviour.stdout !== undefined) {
  process.stdout.write(behaviour.stdout);
}
process.exit(behaviour.exit ?? 0);
`;

interface HookEntry {
  readonly type: 'command';
  readonly bash: string;
  readonly powershell: string;
  readonly timeoutSec: number;
}

/** One hook, or none for a `missing` one, whose script path leads nowhere. */
function hookEntry(scripts: string, kind: 'pre' | 'post', timeoutSec: number, missing: boolean): HookEntry {
  const name = missing ? `absent-${kind}` : kind;
  return {
    type: 'command',
    bash: `sh "${path.join(scripts, `${name}.sh`).replace(/\\/g, '/')}"`,
    powershell: `& "${path.join(scripts, `${name}.ps1`)}"`,
    timeoutSec,
  };
}

export function makeHookFixture(options: { readonly timeoutSec?: number; readonly missingPre?: boolean; readonly invalidConfiguration?: boolean } = {}): HookFixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-hooks-'));
  const hooks = path.join(home, 'hooks');
  const scripts = path.join(home, 'hook-scripts');
  fs.mkdirSync(hooks);
  fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, 'check.mjs'), CHECK);
  for (const kind of ['pre', 'post'] as const) {
    const check = path.join(scripts, 'check.mjs');
    fs.writeFileSync(path.join(scripts, `${kind}.sh`), `#!/bin/sh\nexec node "${check.replace(/\\/g, '/')}" ${kind} "${scripts.replace(/\\/g, '/')}"\n`);
    fs.writeFileSync(path.join(scripts, `${kind}.ps1`), `$input | & node "${check}" ${kind} "${scripts.replace(/\\/g, '/')}"\nexit $LASTEXITCODE\n`);
  }
  const timeoutSec = options.timeoutSec ?? 15;
  fs.writeFileSync(
    path.join(hooks, 'synthetic.json'),
    options.invalidConfiguration === true
      ? '{ this is not a hook file'
      : JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [hookEntry(scripts, 'pre', timeoutSec, options.missingPre === true)],
            postToolUse: [hookEntry(scripts, 'post', timeoutSec, false)],
          },
        }),
  );
  const log = path.join(scripts, 'invocations.jsonl');
  const slept = path.join(scripts, 'slept.log');
  const behave = (behaviours: HookBehaviours): void => {
    fs.writeFileSync(path.join(scripts, 'behaviour.json'), JSON.stringify(behaviours));
  };
  behave({});
  return {
    home,
    behave,
    invocations: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line) as HookInvocation)
        : [],
    slept: () =>
      fs.existsSync(slept)
        ? fs
            .readFileSync(slept, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map(Number)
        : [],
    clear: () => {
      fs.rmSync(log, { force: true });
      fs.rmSync(slept, { force: true });
    },
    remove: () => {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
