import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { TestRun } from './test-run';

/** 返回当前运行专属的头像目录，并拒绝把测试文件指向生产头像目录。 */
export function testAvatarDirectory(run: TestRun) {
  const directory = resolve(
    process.cwd(),
    process.env.AVATAR_STORAGE_DIR || `storage/test-avatars/${run.runId}`,
  );
  const testRoot = resolve(process.cwd(), 'storage/test-avatars');
  if (!directory.startsWith(`${testRoot}/`))
    throw new Error(
      'Test avatar directory must stay under storage/test-avatars',
    );
  run.registerStoragePath(directory);
  return directory;
}

export async function prepareTestStorage(run: TestRun) {
  const directory = testAvatarDirectory(run);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function cleanupTestStorage(run: TestRun) {
  for (const path of run.resources.storagePaths) {
    const directory = isAbsolute(path) ? path : join(process.cwd(), path);
    const testRoot = resolve(process.cwd(), 'storage/test-avatars');
    if (directory.startsWith(`${testRoot}/`))
      await rm(directory, { recursive: true, force: true });
  }
}
