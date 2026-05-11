import { stat } from 'node:fs/promises';

/**
 * Returns `true` when `path` is reachable on the filesystem (file, directory,
 * symlink — anything `stat(2)` resolves). Catches every error rather than
 * distinguishing ENOENT from EACCES because callers treat all failures as
 * "not present" — the build pipeline can't recover from permission errors
 * anyway, and chasing the distinction here would force every caller to
 * specify which errno to swallow.
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
