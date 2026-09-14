import { ExecutionContextStore } from '@platform/observability/execution-context.service';

describe('execution context', () => {
  it('keeps concurrent request/task context separate', async () => {
    const context = new ExecutionContextStore();
    const results = await Promise.all(
      ['a', 'b'].map((requestId) =>
        context.run({ requestId }, async () => {
          await Promise.resolve();
          return context.get().requestId;
        }),
      ),
    );
    expect(results).toEqual(['a', 'b']);
    expect(context.get()).toEqual({});
  });
});
