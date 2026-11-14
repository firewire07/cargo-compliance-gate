import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { LiveStreamService } from '../live/live-stream.service';
import { CreateShipmentRequest, Shipment } from '../models/shipment.model';
import { StatusEvent, statusFromEvent } from '../models/status-event.model';

@Injectable({ providedIn: 'root' })
export class ShipmentsService {
  private readonly http = inject(HttpClient);
  private readonly live = inject(LiveStreamService);
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

  list(): Observable<Shipment[]> {
    return this.http.get<Shipment[]>('/api/shipments').pipe(
      tap((rows) => this.itemsSignal.set(rows)),
    );
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

  applyEvent(event: StatusEvent): void {
    const status = statusFromEvent(event.type);
    if (!status || !event.awb) {
      return;
    }
    const current = this.itemsSignal().find((item) => item.awb === event.awb);
    if (current) {
      this.upsert({ ...current, status });
      return;
    }
    this.getByAwb(event.awb).subscribe({ error: () => undefined });
  }

  /**
   * Reloads the list, then opens SSE. On disconnect, fetches a new stream token
   * and reloads from the API before reconnecting.
   */
  connectLive(): Observable<StatusEvent> {
    return new Observable((subscriber) => {
      const sub = this.live.connect(() => this.list()).subscribe({
        next: (event) => {
          this.applyEvent(event);
          subscriber.next(event);
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
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
