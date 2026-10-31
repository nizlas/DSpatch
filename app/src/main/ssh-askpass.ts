import net from 'node:net';

/*
 * The program `ssh` runs to ask for something (DSP-153), started by the wrapper `SshConnection`
 * writes, in Electron's Node mode. It passes ssh's question to the waiting DSpatch over a socket
 * only this user can reach, and prints the answer for ssh. It keeps nothing.
 */

const socket = net.connect(process.env['DSPATCH_ASKPASS_SOCKET'] ?? '');
let answer = '';
socket.on('connect', () => {
  socket.write(`${JSON.stringify({ nonce: process.env['DSPATCH_ASKPASS_NONCE'], prompt: process.argv[2] ?? '' })}\n`);
});
socket.on('data', (chunk) => {
  answer += chunk.toString('utf8');
});
socket.on('end', () => {
  const reply = JSON.parse(answer === '' ? '{}' : answer) as { answer?: string | null };
  if (typeof reply.answer !== 'string') {
    process.exit(1);
  }
  process.stdout.write(`${reply.answer}\n`);
});
socket.on('error', () => {
  process.exit(1);
});
