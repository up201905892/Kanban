import { spawn } from 'node:child_process';
import process from 'node:process';
import { normalizeArgs } from './e2e-args.mjs';

const args = normalizeArgs(process.argv.slice(2));
const child = spawn('playwright', ['test', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
