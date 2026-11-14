/**
 * Wire format for domain events. schemaVersion is used instead of "version"
 * so it is not confused with shipmentVersion.
 */
export type EventEnvelope<T = unknown> = {
  id: string;
  type: string;
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

export type PartyPayload = {
  name: string;
  country: string;
};

export type ShipmentEventPayload = {
  awb?: string;
  origin?: string;
  destination?: string;
  pieces?: number;
  weight?: number;
  goodsDescription?: string;
  hsCode?: string;
  unNumber?: string;
  routing?: string;
  aircraftType?: string;
  shipper?: PartyPayload;
  consignee?: PartyPayload;
};

export type ScreeningCheckedPayload = {
  check?: string;
  outcome?: string;
  ruleVersion?: string;
  score?: number;
  reasons?: string[];
};
