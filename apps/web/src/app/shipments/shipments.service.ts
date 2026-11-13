import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CreateShipmentRequest, Shipment } from '../models/shipment.model';
import {
  STREAM_EVENT_TYPES,
  StatusEvent,
  statusFromEvent,
} from '../models/status-event.model';

@Injectable({ providedIn: 'root' })
export class ShipmentsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
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
      let source: EventSource | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;

      const closeSource = () => {
        source?.close();
        source = null;
      };

      const schedule = () => {
        if (stopped) {
          return;
        }
        timer = setTimeout(start, 1000);
      };

      const openStream = (token: string) => {
        if (stopped) {
          return;
        }
        source = new EventSource(
          `/api/stream?token=${encodeURIComponent(token)}`,
        );
        for (const type of STREAM_EVENT_TYPES) {
          source.addEventListener(type, (raw) => {
            const message = raw as MessageEvent<string>;
            try {
              const event = JSON.parse(message.data) as StatusEvent;
              this.applyEvent(event);
              subscriber.next(event);
            } catch {
              // ignore malformed payloads
            }
          });
        }
        source.onerror = () => {
          closeSource();
          schedule();
        };
      };

      const start = () => {
        if (stopped) {
          return;
        }
        this.list().subscribe({
          error: () => schedule(),
          next: () => {
            if (stopped) {
              return;
            }
            this.auth.issueStreamToken().subscribe({
              next: ({ token }) => openStream(token),
              error: () => schedule(),
            });
          },
        });
      };

      start();

      return () => {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }
        closeSource();
      };
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
