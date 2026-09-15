import {
  CURRENT_SCHEMA_VERSION,
  TaskPayloadSchema,
  parseVersioned,
} from '@app/modules/ingestion/contracts/schemas';
import {
  stableExternalId,
  taskKey,
  uuidV5,
} from '@app/modules/ingestion/contracts/identifiers';

describe('文档处理版本契约与稳定标识', () => {
  it('读取上一版 JSON 时统一升级到当前版本', () => {
    const parsed = parseVersioned(TaskPayloadSchema, {
      schemaVersion: 0,
      taskId: '11',
      processingRunId: '22',
      attemptNo: 1,
    });
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('未知版本返回稳定错误且不猜测字段', () => {
    expect(() =>
      parseVersioned(TaskPayloadSchema, {
        schemaVersion: 99,
        taskId: '11',
        processingRunId: '22',
        attemptNo: 1,
      }),
    ).toThrow('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('任务键、外部 ID 和 UUIDv5 可重复生成且隔离 run', () => {
    expect(taskKey(10n, 'embed', 'batch:1')).toBe('run:10:embed:batch:1');
    expect(stableExternalId(10n, 20n)).toBe(stableExternalId('10', '20'));
    expect(stableExternalId(10n, 20n)).not.toBe(stableExternalId(11n, 20n));
    expect(uuidV5(10n, 20n)).toBe(uuidV5('10', '20'));
    expect(uuidV5(10n, 20n)).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });
});
