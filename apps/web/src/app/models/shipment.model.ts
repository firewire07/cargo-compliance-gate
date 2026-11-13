export type ShipmentStatus =
  | 'SUBMITTED'
  | 'CHECKING'
  | 'HELD'
  | 'CLEARED'
  | 'RELEASED';

export interface Party {
  id?: string;
  role?: 'SHIPPER' | 'CONSIGNEE';
  name: string;
  country: string;
}

export interface Shipment {
  id: string;
  awb: string;
  origin: string;
  destination: string;
  pieces: number;
  weight: number;
  goodsDescription: string;
  hsCode?: string | null;
  unNumber?: string | null;
  routing: string;
  status: ShipmentStatus;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  parties?: Party[];
}

export interface CreateShipmentRequest {
  awb: string;
  origin: string;
  destination: string;
  pieces: number;
  weight: number;
  goodsDescription: string;
  hsCode?: string;
  unNumber?: string;
  routing: string;
  shipper: { name: string; country: string };
  consignee: { name: string; country: string };
}
