export const SHIPMENT_SUBMITTED = 'shipment.submitted' as const;
export const SHIPMENT_HELD = 'shipment.held' as const;
export const SHIPMENT_CLEARED = 'shipment.cleared' as const;
export const SCREENING_CHECKED = 'screening.checked' as const;

export const SHIPMENT_EVENTS_TOPIC = 'shipment.events';
export const HOLD_EVENTS_TOPIC = 'hold.events';
export const SCREENING_EVENTS_TOPIC = 'screening.events';

export type EventEnvelope<T = unknown> = {
  id: string;
  type: string;
  // Plan §2 uses schemaVersion (not "version") so it is not confused with shipmentVersion.
  schemaVersion: number;
  occurredAt: string;
  correlationId: string;
  awb: string;
  shipmentVersion: number;
  payload: T;
};

export type ScreeningCheckedPayload = {
  check?: string;
  outcome?: string;
  ruleVersion?: string;
  score?: number;
  reasons?: string[];
};
