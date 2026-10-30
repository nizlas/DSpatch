/**
 * What Copilot's runtime sees on this machine (DSP-148). Run it where the work runs, on the host:
 *
 *     npm run copilot:check          (from app/)
 *
 * It starts the runtime DSpatch uses, asks for its version, the login and the hooks it finds, and
 * ends. It sends no prompt, starts no session, prints no token and writes nothing of DSpatch's.
 * A token variable in the environment shows as the login that would be used.
 */

import process from 'node:process';

import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient({ logLevel: 'error', useLoggedInUser: true });
await client.start();
const status = await client.getStatus();
const auth = await client.getAuthStatus();
process.stdout.write(`Copilot runtime ${status.version}, protocol ${String(status.protocolVersion)}\n`);
process.stdout.write(auth.isAuthenticated ? `Signed in as ${auth.login ?? 'unknown'} at ${auth.host ?? 'unknown host'} (${auth.authType ?? 'unknown'} login)\n` : 'Not signed in on this machine.\n');
const found = await client.rpc.hooks.discover({});
process.stdout.write(`Hooks found: ${String(found.hooks.length)}\n`);
for (const hook of found.hooks) {
  process.stdout.write(`  ${hook.origin} ${hook.hookType}${hook.enabled ? '' : ' (off)'}\n`);
}
if (auth.isAuthenticated) {
  const models = await client.listModels();
  process.stdout.write(`Models this account can ask for: ${models.map((model) => model.id).join(', ') || 'none'}\n`);
}
await client.stop();
process.exit(0);
