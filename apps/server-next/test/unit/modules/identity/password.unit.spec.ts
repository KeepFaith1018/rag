import { hash } from 'bcrypt';
import { PasswordService } from '@app/modules/identity/services/password.service';

describe('password change rules', () => {
  const userId = 10n;
  const oldPassword = 'old-password-123';
  const user = {
    id: userId,
    password_hash: '',
  };
  const queryRaw = jest.fn().mockResolvedValue([{ id: userId }]);
  const sessions = { updateMany: jest.fn() };
  const tx = { $queryRaw: queryRaw, b_user_sessions: sessions };
  const transaction = jest.fn((callback: (value: unknown) => unknown) =>
    callback(tx),
  );
  const users = {
    requireActiveById: jest.fn(),
    updatePassword: jest.fn(),
  };
  const service = new PasswordService(
    { $transaction: transaction } as never,
    users as never,
    {} as never,
  );

  beforeEach(async () => {
    user.password_hash = await hash(oldPassword, 4);
    users.requireActiveById.mockReset().mockResolvedValue(user);
    users.updatePassword.mockReset().mockResolvedValue(undefined);
    sessions.updateMany.mockReset().mockResolvedValue({ count: 1 });
    queryRaw.mockClear();
    transaction.mockClear();
  });

  it('rejects the old password as the new password', async () => {
    await expect(
      service.change(userId, oldPassword, oldPassword),
    ).rejects.toMatchObject({ code: 40000 });
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(sessions.updateMany).not.toHaveBeenCalled();
  });

  it('revokes every active session after a successful change', async () => {
    await expect(
      service.change(userId, oldPassword, 'new-password-123'),
    ).resolves.toEqual({ message: '密码修改成功，请重新登录' });
    expect(users.updatePassword).toHaveBeenCalledWith(
      userId,
      expect.any(String),
      tx,
    );
    const calls = (
      sessions.updateMany as unknown as jest.Mock<unknown, [unknown]>
    ).mock.calls;
    const call = calls[0]?.[0] as {
      where: { user_id: bigint; revoked: boolean };
      data: { revoked: boolean; revoked_at: unknown };
    };
    expect(call.where).toEqual({ user_id: userId, revoked: false });
    expect(call.data.revoked).toBe(true);
    expect(call.data.revoked_at).toBeInstanceOf(Date);
  });

  it('rejects an incorrect old password before writing', async () => {
    await expect(
      service.change(userId, 'wrong-password-123', 'new-password-123'),
    ).rejects.toMatchObject({ code: 47001 });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});
