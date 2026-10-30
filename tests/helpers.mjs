import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Runs the rest of a test in a fresh temporary directory with an empty data/review/, removed afterwards. */
export async function inTempDir(t) {
  const original = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-test-'));
  process.chdir(dir);
  t.after(async () => { process.chdir(original); await fs.rm(dir, { recursive: true, force: true }); });
  await fs.mkdir('data/review', { recursive: true });
  return dir;
}
