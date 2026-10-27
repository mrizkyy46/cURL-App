import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run both watchers without a shell so this works on Windows and POSIX.
const children = [
  spawn(process.execPath, ['--watch', 'server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, [fileURLToPath(new URL('../node_modules/@tailwindcss/cli/dist/index.mjs', import.meta.url)), '-i', './src/styles/tailwind.css', '-o', './src/public/css/tailwind.css', '--watch'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
