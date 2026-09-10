import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { UserAccountsService } from './user-accounts.service';

/** 负责当前用户资料的读取与可编辑字段更新。 */
@Injectable()
export class UserProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: UserAccountsService,
  ) {}

  async get(userId: bigint) {
    return this.accounts.buildProfile(
      await this.accounts.requireActiveById(userId),
    );
  }

  async update(userId: bigint, input: { full_name?: string }) {
    await this.accounts.requireActiveById(userId);
    const user = await this.prisma.b_users.update({
      where: { id: userId },
      data:
        input.full_name === undefined
          ? {}
          : { full_name: input.full_name || null },
    });
    return this.accounts.buildProfile(user);
  }
}
