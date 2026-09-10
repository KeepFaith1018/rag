import { parseId } from '@shared/parse-id';
import { toJsonValue } from '@shared/serialization';

describe('ID boundary', () => {
  it('preserves large IDs through parsing and nested JSON serialization', () => {
    const id = parseId('9007199254740993');
    expect(
      toJsonValue({ items: [{ id }], at: new Date('2026-09-05T00:00:00Z') }),
    ).toEqual({
      items: [{ id: '9007199254740993' }],
      at: '2026-09-05T00:00:00.000Z',
    });
    expect(() => JSON.stringify(1n)).toThrow();
  });
  it.each(['', '0', '-1', '1.5', '1e3', '01', '9223372036854775808'])(
    'rejects %s',
    (id) => {
      expect(() => parseId(id)).toThrow('ID');
    },
  );
});
