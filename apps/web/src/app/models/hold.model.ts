import { ShipmentStatus } from './shipment.model';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  note?: string;
}

export type HoldPhase = 'OPEN' | 'RELEASE_REQUESTED' | 'REJECTED' | 'RELEASED';

export interface Hold {
  id: string;
  awb: string;
  shipmentVersion: number;
  reasons: string[];
  checklist: ChecklistItem[];
  releaseRequestedBy?: string | null;
  releaseRequestedAt?: string | null;
  releaseApprovedBy?: string | null;
  releaseApprovedAt?: string | null;
  releaseRejectedBy?: string | null;
  releaseRejectedAt?: string | null;
  releaseRejectionReason?: string | null;
  createdAt: string;
  shipmentStatus?: ShipmentStatus | string;
}

export function holdPhase(hold: Hold): HoldPhase {
  if (hold.releaseApprovedBy || hold.shipmentStatus === 'RELEASED') {
    return 'RELEASED';
  }
  if (hold.releaseRequestedBy && !hold.releaseRejectedAt) {
    return 'RELEASE_REQUESTED';
  }
  if (hold.releaseRejectedAt) {
    return 'REJECTED';
  }
  return 'OPEN';
}

export function checklistComplete(items: ChecklistItem[] | undefined): boolean {
  return !!items?.length && items.every((item) => item.done);
}
