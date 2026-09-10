import { ExecutionContextStore } from '@platform/observability/execution-context.service';
import { redact } from '@platform/observability/redact';

describe('logging context and redaction', () => {
  it('redacts nested credentials, URLs and third-party error messages', () => {
    const output = JSON.stringify(
      redact({
        password: 'secret1',
        nested: { refreshToken: 'secret2' },
        error: new Error('secret3'),
        message: 'mysql://u:secret4@host/db',
        id: 1n,
      }),
    );
    for (const secret of ['secret1', 'secret2', 'secret3', 'secret4'])
      expect(output).not.toContain(secret);
    expect(output).toContain('REDACTED');
  });
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
