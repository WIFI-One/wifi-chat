/** Max attachment size (MB). Set via `pnpm dev -- --max-file-mb=<n>` (dev script
 * forwards it as VITE_MAX_FILE_SIZE_MB) or `VITE_MAX_FILE_SIZE_MB` directly. */

export const DEFAULT_MAX_FILE_SIZE_MB = 1024;

export function getMaxFileSizeMB(): number {
  const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
  const raw = env?.VITE_MAX_FILE_SIZE_MB;
  const n = raw !== undefined && raw !== '' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 4096);
  return DEFAULT_MAX_FILE_SIZE_MB;
}

export function getMaxFileBytes(): number {
  return Math.floor(getMaxFileSizeMB() * 1024 * 1024);
}

export function fileTooLarge(fileSize: number): boolean {
  return fileSize > getMaxFileBytes();
}

export function formatMaxSize(): string {
  const mb = getMaxFileSizeMB();
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function fileSizeError(fileSize: number): string | null {
  if (!fileTooLarge(fileSize)) return null;
  return `File too large (max ${formatMaxSize()}).`;
}
