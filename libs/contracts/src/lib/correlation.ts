import { randomUUID } from 'crypto';

/**
 * One name for the correlation ID everywhere: HTTP header (set by the gateway),
 * outbox column, Kafka message header and the `correlationId` field in logs.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;

/** kafkajs header values can be Buffer, string, or arrays of those. */
type RawHeaderValue = Buffer | string | (Buffer | string)[] | undefined;

/** Decodes Kafka message headers into plain strings (first value wins). */
export function decodeKafkaHeaders(
  headers?: Record<string, RawHeaderValue>,
): Record<string, string | undefined> {
  const decoded: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    decoded[key.toLowerCase()] = first === undefined ? undefined : first.toString();
  }
  return decoded;
}

/** Returns the first non-empty candidate, or a fresh UUID if none is usable. */
export function resolveCorrelationId(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }
  return randomUUID();
}

/**
 * Formats a structured log line: `{"event":"...","correlationId":"...",...}`.
 * Nest's Logger adds timestamp and context; the JSON body stays greppable
 * (`docker compose logs | grep <id>`) and parseable by log shippers.
 */
export function logLine(
  event: string,
  fields: { correlationId?: string } & Record<string, unknown> = {},
): string {
  return JSON.stringify({ event, ...fields });
}
