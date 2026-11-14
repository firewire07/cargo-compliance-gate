import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LiveStreamService } from '../live/live-stream.service';
import { ChecklistItem, Hold } from '../models/hold.model';
import { HOLD_EVENT_TYPES, StatusEvent } from '../models/status-event.model';

const HOLD_REFRESH_TYPES = new Set([
  ...HOLD_EVENT_TYPES,
  'shipment.held',
  'shipment.released',
]);

@Injectable({ providedIn: 'root' })
export class HoldsService {
  private readonly http = inject(HttpClient);
  private readonly live = inject(LiveStreamService);
  private readonly itemsSignal = signal<Hold[]>([]);
  readonly items = this.itemsSignal.asReadonly();

  list(): Observable<Hold[]> {
    return this.http
      .get<Hold[]>('/api/holds')
      .pipe(tap((rows) => this.itemsSignal.set(rows)));
  }

  get(awb: string): Observable<Hold> {
    return this.http
      .get<Hold>(`/api/holds/${encodeURIComponent(awb)}`)
      .pipe(tap((hold) => this.upsert(hold)));
  }

  updateChecklist(awb: string, items: ChecklistItem[]): Observable<Hold> {
    return this.http
      .patch<Hold>(`/api/holds/${encodeURIComponent(awb)}/checklist`, {
        items: items.map(({ id, done, note }) => ({ id, done, note })),
      })
      .pipe(tap((hold) => this.upsert(hold)));
  }

  requestRelease(awb: string): Observable<Hold> {
    return this.http
      .post<Hold>(`/api/holds/${encodeURIComponent(awb)}/release-requests`, {})
      .pipe(tap((hold) => this.upsert(hold)));
  }

  approveRelease(awb: string): Observable<{ holdId: string; shipment?: unknown }> {
    return this.http
      .post<{ holdId: string; shipment?: unknown }>(
        `/api/holds/${encodeURIComponent(awb)}/release-approvals`,
        {},
      )
      .pipe(tap(() => this.get(awb).subscribe({ error: () => undefined })));
  }

  rejectRelease(awb: string, reason?: string): Observable<Hold> {
    return this.http
      .post<Hold>(`/api/holds/${encodeURIComponent(awb)}/release-rejections`, {
        reason,
      })
      .pipe(tap((hold) => this.upsert(hold)));
  }

  applyEvent(event: StatusEvent): void {
    if (!event.awb || !HOLD_REFRESH_TYPES.has(event.type)) {
      return;
    }
    this.get(event.awb).subscribe({
      error: () => undefined,
    });
  }

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

  private upsert(hold: Hold): void {
    const current = this.itemsSignal();
    const index = current.findIndex((item) => item.id === hold.id || item.awb === hold.awb);
    if (index === -1) {
      this.itemsSignal.set([hold, ...current]);
      return;
    }
    const next = current.slice();
    next[index] = hold;
    this.itemsSignal.set(next);
  }
}
