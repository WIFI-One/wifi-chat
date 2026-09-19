#!/usr/bin/env node
// `pnpm dev --file-size {max MB}` — starts server + client with the same
// file-size limit. Also honors MAX_FILE_SIZE_MB / MAX_FILE_MB env vars.
// Examples:
//   pnpm dev --file-size 50
//   pnpm dev --file-size=100
//   MAX_FILE_SIZE_MB=50 pnpm dev
import { spawn } from 'node:child_process';

const DEFAULT_MB = 1024;

function parseMb(value) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 4096);
}

function parseMaxMb(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.match(/^--(?:file-size|max-file(?:-size)?(?:-mb)?|file-limit-mb?|attachments?-limit-mb?)=(.+)$/i);
    if (eq) {
      const parsed = parseMb(eq[1]);
      if (parsed !== null) return parsed;
      console.error(`[dev] Ignoring invalid file-size value: ${eq[1]}`);
    } else if (/^--(?:file-size|max-file(?:-size)?(?:-mb)?|file-limit-mb?|attachments?-limit-mb?)$/i.test(arg)) {
      const next = argv[i + 1];
      const parsed = parseMb(next);
      if (parsed !== null) return parsed;
      console.error(`[dev] Ignoring invalid file-size value: ${next ?? '(missing)'}`);
    } else if (/^--help$|^-h$/i.test(arg)) {
      console.log('Usage: pnpm dev --file-size <MB>');
      console.log('  --file-size 50     allow attachments up to 50 MB (default 1 GB, max 4 GB)');
      console.log('  Env alternative: MAX_FILE_SIZE_MB=50 pnpm dev');
      process.exit(0);
    }
  }
  return (
    parseMb(process.env.MAX_FILE_SIZE_MB) ??
    parseMb(process.env.MAX_FILE_MB) ??
    parseMb(process.env.WIFICHAT_MAX_FILE_MB) ??
    DEFAULT_MB
  );
}

const maxMb = parseMaxMb(process.argv.slice(2));
const maxStr = String(maxMb);
const maxLabel = maxMb >= 1024 && maxMb % 1024 === 0 ? `${maxMb / 1024} GB` : `${maxMb} MB`;

const children = [];
function run(label, cmd, args, env) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) console.log(`[dev] ${label} stopped (${signal})`);
    else if (code !== 0 && code !== null) console.log(`[dev] ${label} exited with code ${code}`);
  });
  return child;
}

console.log(`[dev] Starting WifiChat (max file: ${maxLabel})…`);
// Server reads MAX_FILE_SIZE_MB / --max-file-mb; client (Vite) reads VITE_*.
run('server', 'pnpm', ['run', 'dev:server', '--', `--max-file-mb=${maxStr}`], {
  MAX_FILE_SIZE_MB: maxStr,
});
run('client', 'pnpm', ['run', 'dev:client'], {
  MAX_FILE_SIZE_MB: maxStr,
  VITE_MAX_FILE_SIZE_MB: maxStr,
});

function shutdown(signal) {
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
