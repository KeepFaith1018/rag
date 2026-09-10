import { randomBytes } from 'node:crypto';

export interface TestResources {
  userIds: Set<bigint>;
  knowledgeBaseIds: Set<bigint>;
  emailAddresses: Set<string>;
  redisKeys: Set<string>;
  storagePaths: Set<string>;
}

/** 管理一次测试运行的隔离标识和资源登记表。 */
export class TestRun {
  readonly resources: TestResources = {
    userIds: new Set(),
    knowledgeBaseIds: new Set(),
    emailAddresses: new Set(),
    redisKeys: new Set(),
    storagePaths: new Set(),
  };

  constructor(readonly runId: string) {}

  email(role: string) {
    const email = `server-next-test-${role}-${this.runId}@example.test`;
    this.resources.emailAddresses.add(email);
    return email;
  }

  username(role: string) {
    return `[TEST ${this.runId}] ${role}`.slice(0, 100);
  }

  knowledgeBaseName(label: string) {
    return `[TEST ${this.runId}] ${label}`.slice(0, 100);
  }

  registerUser(id: bigint, email?: string) {
    this.resources.userIds.add(id);
    if (email) this.resources.emailAddresses.add(email);
  }

  registerKnowledgeBase(id: bigint) {
    this.resources.knowledgeBaseIds.add(id);
  }

  registerRedisKey(key: string) {
    this.resources.redisKeys.add(key);
  }

  registerStoragePath(path: string) {
    this.resources.storagePaths.add(path);
  }
}

function newRunId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `test-${date}-${randomBytes(4).toString('hex')}`;
}

/** 在同一个 Jest 进程内复用运行标识，保证配置和测试资源指向同一命名空间。 */
export function createTestRun() {
  const runId = process.env.TEST_RUN_ID || newRunId();
  process.env.TEST_RUN_ID ??= runId;
  return new TestRun(runId);
}

/** 为真实基础设施测试设置独立的 Redis Key 和头像目录。 */
export function configureTestEnvironment(run: TestRun) {
  process.env.REDIS_KEY_PREFIX ??= `server-next:test:${run.runId}:`;
  process.env.AVATAR_STORAGE_DIR ??= `storage/test-avatars/${run.runId}`;
  process.env.NODE_ENV ??= 'test';
  process.env.LOG_LEVEL ??= 'silent';
}
