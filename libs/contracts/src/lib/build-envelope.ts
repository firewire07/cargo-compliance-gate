import { randomUUID } from 'crypto';
import { EVENT_SCHEMA_VERSION } from './constants';
import type { EventActor, EventEnvelope } from './types';

export type BuildEventEnvelopeInput<T> = {
  id?: string;
  type: string;
  awb: string;
  shipmentVersion: number;
  correlationId: string;
  payload: T;
  actor?: EventActor;
  occurredAt?: string;
  schemaVersion?: number;
};

/** Builds a domain event. `actor` is omitted when not provided, matching the existing wire format. */
export function buildEventEnvelope<T>(
  input: BuildEventEnvelopeInput<T>,
): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    id: input.id ?? randomUUID(),
    type: input.type,
    schemaVersion: input.schemaVersion ?? EVENT_SCHEMA_VERSION,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    awb: input.awb,
    shipmentVersion: input.shipmentVersion,
    payload: input.payload,
  };
  if (input.actor) {
    envelope.actor = input.actor;
  }
  return envelope;
}
