import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { STREAM_EVENT_TYPES, StatusEvent } from '../models/status-event.model';

/**
 * Shared SSE connection used by the shipments list, hold queue and detail page.
 * On disconnect it optionally reloads from the API, then fetches a fresh
 * short-lived stream token before reconnecting.
 */
@Injectable({ providedIn: 'root' })
export class LiveStreamService {
  private readonly auth = inject(AuthService);

  connect(reload?: () => Observable<unknown>): Observable<StatusEvent> {
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
        if (stopped || typeof EventSource === 'undefined') {
          return;
        }
        source = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
        for (const type of STREAM_EVENT_TYPES) {
          source.addEventListener(type, (raw) => {
            const message = raw as MessageEvent<string>;
            try {
              subscriber.next(JSON.parse(message.data) as StatusEvent);
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

      const afterReload = () => {
        if (stopped) {
          return;
        }
        this.auth.issueStreamToken().subscribe({
          next: ({ token }) => openStream(token),
          error: () => schedule(),
        });
      };

      const start = () => {
        if (stopped) {
          return;
        }
        const prelude = reload ? reload() : of(null);
        prelude.subscribe({
          next: afterReload,
          error: () => schedule(),
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
}
