import { ShipmentStatus } from './shipment.model';

export interface StatusEvent {
  id: string;
  type: string;
  awb: string;
  shipmentVersion?: number;
  occurredAt?: string;
  correlationId?: string;
  payload?: unknown;
}

const STATUS_BY_EVENT: Record<string, ShipmentStatus> = {
  'shipment.submitted': 'CHECKING',
  'shipment.cleared': 'CLEARED',
  'shipment.held': 'HELD',
  'shipment.released': 'RELEASED',
};

export function statusFromEvent(type: string): ShipmentStatus | null {
  return STATUS_BY_EVENT[type] ?? null;
}

export const STREAM_EVENT_TYPES = Object.keys(STATUS_BY_EVENT);
