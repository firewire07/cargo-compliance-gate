import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CreateShipmentRequest, Shipment } from '../models/shipment.model';

@Injectable({ providedIn: 'root' })
export class ShipmentsService {
  private readonly http = inject(HttpClient);
  private pendingIdempotencyKey: string | null = null;
  private readonly itemsSignal = signal<Shipment[]>([]);
  readonly items = this.itemsSignal.asReadonly();

  /** One UUID per form submission; reused if the same attempt is retried. */
  peekOrCreateIdempotencyKey(): string {
    this.pendingIdempotencyKey ??= globalThis.crypto.randomUUID();
    return this.pendingIdempotencyKey;
  }

  clearIdempotencyKey(): void {
    this.pendingIdempotencyKey = null;
  }

  create(body: CreateShipmentRequest): Observable<Shipment> {
    const key = this.peekOrCreateIdempotencyKey();
    return this.http
      .post<Shipment>('/api/shipments', body, {
        headers: { 'Idempotency-Key': key },
      })
      .pipe(
        tap((shipment) => {
          this.clearIdempotencyKey();
          this.upsert(shipment);
        }),
      );
  }

  getByAwb(awb: string): Observable<Shipment> {
    return this.http
      .get<Shipment>(`/api/shipments/${encodeURIComponent(awb)}`)
      .pipe(tap((shipment) => this.upsert(shipment)));
  }

  private upsert(shipment: Shipment): void {
    const current = this.itemsSignal();
    const index = current.findIndex((item) => item.awb === shipment.awb);
    if (index === -1) {
      this.itemsSignal.set([shipment, ...current]);
      return;
    }
    const next = current.slice();
    next[index] = shipment;
    this.itemsSignal.set(next);
  }
}
