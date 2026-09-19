/** Max attachment size (MB). Single source of truth for the server. */

export const DEFAULT_MAX_FILE_SIZE_MB = 1024;

function parseMb(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 4096);
}

function parseArgs(argv: string[] = process.argv.slice(2)): number | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.match(/^--(?:file-size|max-file(?:-size)?(?:-mb)?|file-limit-mb?|attachments?-limit-mb?)=(.+)$/i);
    if (eq) {
      const parsed = parseMb(eq[1]);
      if (parsed !== null) return parsed;
    }
    if (/^--(?:file-size|max-file(?:-size)?(?:-mb)?|file-limit-mb?|attachments?-limit-mb?)$/i.test(arg)) {
      const next = argv[i + 1];
      if (next !== undefined) {
        const parsed = parseMb(next);
        if (parsed !== null) return parsed;
      }
    }
  }
  return null;
}

/** CLI flag wins, then env, then the built-in default. */
export function getMaxFileSizeMB(argv: string[] = process.argv.slice(2)): number {
  return (
    parseArgs(argv) ??
    parseMb(process.env.MAX_FILE_SIZE_MB) ??
    parseMb(process.env.MAX_FILE_MB) ??
    parseMb(process.env.WIFICHAT_MAX_FILE_MB) ??
    DEFAULT_MAX_FILE_SIZE_MB
  );
}

export function getMaxFileBytes(argv?: string[]): number {
  return Math.floor(getMaxFileSizeMB(argv) * 1024 * 1024);
}

export function formatFileSize(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
