export const SHIPMENT_SUBMITTED = 'shipment.submitted' as const;
export const SHIPMENT_UPDATED = 'shipment.updated' as const;
export const SCREENING_CHECKED = 'screening.checked' as const;

export const SCREENED_SHIPMENT_TYPES = [SHIPMENT_SUBMITTED, SHIPMENT_UPDATED] as const;

export type EventEnvelope<T = unknown> = {
  id: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  correlationId: string;
  awb: string;
  shipmentVersion: number;
  payload: T;
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
