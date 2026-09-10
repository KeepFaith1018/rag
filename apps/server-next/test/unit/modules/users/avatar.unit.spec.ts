import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { AvatarService } from '@app/modules/users/services/avatar.service';

describe('avatar storage boundary', () => {
  let directory: string;
  let service: AvatarService;
  const update = jest.fn();
  const requireActiveById = jest.fn();
  const findById = jest.fn();
  const buildProfile = jest.fn(
    (user: {
      id: bigint;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    }) => ({
      id: user.id.toString(),
      email: user.email,
      username: user.full_name ?? user.email,
      avatar: user.avatar_url,
      roles: ['user'],
    }),
  );
  const db = { b_users: { update } };
  const accounts = { requireActiveById, findById, buildProfile };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'server-next-avatar-'));
    const config = new RuntimeConfig(
      new ConfigService(
        validateEnvironment({
          DATABASE_URL: 'mysql://test:test@localhost/rag_kb_next',
          REDIS_URL: 'redis://localhost:6379',
          JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
          VERIFICATION_CODE_SECRET:
            'test-verification-secret-with-at-least-32-chars',
          AVATAR_STORAGE_DIR: directory,
        }),
      ),
    );
    service = new AvatarService(config, db as never, accounts as never);
    update.mockReset();
    requireActiveById.mockReset().mockResolvedValue({
      id: 1n,
      avatar_url: null,
      deleted_at: null,
      is_active: true,
    });
    findById.mockReset();
    buildProfile.mockClear();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['png', png(), '.png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), '.jpg'],
    ['gif', Buffer.from('GIF89a'), '.gif'],
    ['webp', webp(), '.webp'],
  ])('accepts %s signature bytes', async (_name, bytes, extension) => {
    update.mockImplementation(({ data }: { data: { avatar_url: string } }) => ({
      id: 1n,
      avatar_url: data.avatar_url,
      full_name: null,
      email: 'avatar@example.test',
    }));
    const profile = await service.update(1n, bytes);
    if (!profile.avatar) throw new Error('Avatar profile URL was not returned');
    expect(profile.avatar).toMatch(new RegExp(`\\${extension}$`));
    const saved = await readFile(join(directory, profile.avatar));
    expect(saved.equals(bytes)).toBe(true);
  });

  it('removes the replaced file after the database points to the new file', async () => {
    const oldFile = join(directory, 'old.png');
    await writeFile(oldFile, png());
    requireActiveById.mockResolvedValue({ id: 1n, avatar_url: 'old.png' });
    update.mockImplementation(({ data }: { data: { avatar_url: string } }) => ({
      id: 1n,
      avatar_url: data.avatar_url,
      full_name: null,
      email: 'avatar@example.test',
    }));
    const profile = await service.update(1n, png());
    await expect(readFile(oldFile)).rejects.toThrow();
    if (!profile.avatar) throw new Error('Avatar profile URL was not returned');
    await expect(
      readFile(join(directory, profile.avatar)),
    ).resolves.toBeTruthy();
  });

  it('rejects forged bytes and unsafe stored paths', async () => {
    await expect(
      service.update(1n, Buffer.from('not-an-image')),
    ).rejects.toMatchObject({
      code: 40000,
    });
    findById.mockResolvedValue({
      id: 1n,
      avatar_url: '../outside.png',
      deleted_at: null,
      is_active: true,
    });
    await expect(service.read(1n)).rejects.toMatchObject({ code: 40400 });
  });

  function png() {
    return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }

  function webp() {
    const bytes = Buffer.alloc(12);
    bytes.write('RIFF', 0, 'ascii');
    bytes.write('WEBP', 8, 'ascii');
    return bytes;
  }
});
