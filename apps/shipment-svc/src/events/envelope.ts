export const SHIPMENT_SUBMITTED = 'shipment.submitted' as const;
export const SHIPMENT_HELD = 'shipment.held' as const;
export const SHIPMENT_CLEARED = 'shipment.cleared' as const;
export const SHIPMENT_RELEASED = 'shipment.released' as const;
export const HOLD_CHECKLIST_UPDATED = 'hold.checklist.updated' as const;
export const HOLD_RELEASE_REQUESTED = 'hold.release.requested' as const;
export const HOLD_RELEASE_APPROVED = 'hold.release.approved' as const;
export const HOLD_RELEASE_REJECTED = 'hold.release.rejected' as const;
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
  actor?: EventActor;
  payload: T;
};

export type EventActor = {
  actorId: string;
  role: string;
  at: string;
};

export type ScreeningCheckedPayload = {
  check?: string;
  outcome?: string;
  ruleVersion?: string;
  score?: number;
  reasons?: string[];
};
