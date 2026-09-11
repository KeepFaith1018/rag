import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { AvatarService } from '@app/modules/users/services/avatar.service';

describe('avatar storage boundary', () => {
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
  const storage = {
    putObject: jest.fn(),
    headObject: jest.fn(),
    readObject: jest.fn(),
    deleteObject: jest.fn(),
  };

  beforeEach(() => {
    const config = new RuntimeConfig(
      new ConfigService(
        validateEnvironment({
          DATABASE_URL: 'mysql://test:test@localhost/rag_kb_next',
          REDIS_URL: 'redis://localhost:6379',
          JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
          VERIFICATION_CODE_SECRET:
            'test-verification-secret-with-at-least-32-chars',
        }),
      ),
    );
    service = new AvatarService(
      config,
      db as never,
      accounts as never,
      storage as never,
    );
    update.mockReset();
    requireActiveById.mockReset().mockResolvedValue({
      id: 1n,
      avatar_url: null,
      deleted_at: null,
      is_active: true,
    });
    findById.mockReset();
    buildProfile.mockClear();
    storage.putObject.mockReset().mockResolvedValue({ etag: 'avatar-etag' });
    storage.headObject.mockReset();
    storage.readObject.mockReset();
    storage.deleteObject.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['png', png(), '.png', 'image/png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), '.jpg', 'image/jpeg'],
    ['gif', Buffer.from('GIF89a'), '.gif', 'image/gif'],
    ['webp', webp(), '.webp', 'image/webp'],
  ])('accepts %s signature bytes', async (_name, bytes, extension, mime) => {
    update.mockImplementation(({ data }: { data: { avatar_url: string } }) => ({
      id: 1n,
      avatar_url: data.avatar_url,
      full_name: null,
      email: 'avatar@example.test',
    }));
    const profile = await service.update(1n, bytes);
    if (!profile.avatar) throw new Error('Avatar profile URL was not returned');
    expect(profile.avatar).toMatch(
      new RegExp(`^avatars/1/[0-9a-f-]{36}\\${extension}$`),
    );
    expect(storage.putObject).toHaveBeenCalledWith({
      bucket: 'rag-documents',
      key: profile.avatar,
      body: bytes,
      contentType: mime,
    });
  });

  it('removes the replaced object after the database points to the new key', async () => {
    const oldKey = 'avatars/1/00000000-0000-0000-0000-000000000001.png';
    requireActiveById.mockResolvedValue({ id: 1n, avatar_url: oldKey });
    update.mockImplementation(({ data }: { data: { avatar_url: string } }) => ({
      id: 1n,
      avatar_url: data.avatar_url,
      full_name: null,
      email: 'avatar@example.test',
    }));
    await service.update(1n, png());
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'rag-documents',
      key: oldKey,
    });
  });

  it('reads a stored object and rejects unsafe stored keys', async () => {
    const key = 'avatars/1/00000000-0000-0000-0000-000000000001.png';
    findById.mockResolvedValue({
      id: 1n,
      avatar_url: key,
      deleted_at: null,
      is_active: true,
    });
    storage.headObject.mockResolvedValue({
      size: 8,
      etag: 'etag',
      contentType: 'image/png',
    });
    storage.readObject.mockResolvedValue({});
    await expect(service.read(1n)).resolves.toBeDefined();
    expect(storage.readObject).toHaveBeenCalledWith({
      bucket: 'rag-documents',
      key,
    });

    findById.mockResolvedValue({
      id: 1n,
      avatar_url: '../outside.png',
      deleted_at: null,
      is_active: true,
    });
    await expect(service.read(1n)).rejects.toMatchObject({ code: 40400 });
  });

  it('rejects forged bytes', async () => {
    await expect(
      service.update(1n, Buffer.from('not-an-image')),
    ).rejects.toMatchObject({ code: 40000 });
    expect(storage.putObject).not.toHaveBeenCalled();
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
