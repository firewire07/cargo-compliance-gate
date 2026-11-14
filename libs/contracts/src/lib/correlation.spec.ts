import {
  CORRELATION_ID_HEADER,
  decodeKafkaHeaders,
  logLine,
  resolveCorrelationId,
} from './correlation';

describe('correlation helpers', () => {
  it('uses the lowercase x-correlation-id header name', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });

  it('decodes Buffer, string and array Kafka header values', () => {
    expect(
      decodeKafkaHeaders({
        'x-correlation-id': Buffer.from('corr-buf'),
        plain: 'text',
        multi: [Buffer.from('first'), 'second'],
        missing: undefined,
      }),
    ).toEqual({
      'x-correlation-id': 'corr-buf',
      plain: 'text',
      multi: 'first',
      missing: undefined,
    });
    expect(decodeKafkaHeaders(undefined)).toEqual({});
  });

  it('lowercases header keys so lookups are case-insensitive', () => {
    expect(decodeKafkaHeaders({ 'X-Correlation-Id': 'abc' })[CORRELATION_ID_HEADER]).toBe('abc');
  });

  it('returns the first non-blank candidate', () => {
    expect(resolveCorrelationId(undefined, '  ', ' corr-2 ', 'corr-3')).toBe('corr-2');
  });

  it('generates a UUID when no candidate is usable', () => {
    expect(resolveCorrelationId(undefined, null, '')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('formats a JSON log line with event first', () => {
    const line = logLine('outbox.published', { correlationId: 'corr-1', awb: '020-1' });
    expect(JSON.parse(line)).toEqual({ event: 'outbox.published', correlationId: 'corr-1', awb: '020-1' });
    expect(line.startsWith('{"event":"outbox.published"')).toBe(true);
  });
});
