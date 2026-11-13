import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { LoginResponse, SessionUser } from '../models/user.model';

/**
 * Access token is kept in sessionStorage so a refresh stays signed in, and is
 * sent as Authorization: Bearer. The gateway also sets an HttpOnly cookie, but
 * EventSource cannot send the Authorization header, so the live list uses a
 * short-lived stream token from POST /auth/stream-token instead of relying on
 * the cookie alone (the cookie still works same-origin through the dev proxy).
 */
const STORAGE_KEY = 'ccg.session';

type StoredSession = {
  accessToken: string;
  user: SessionUser;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private token: string | null = null;
  private readonly userSignal = signal<SessionUser | null>(null);

  readonly user = this.userSignal.asReadonly();

  constructor() {
    const stored = this.readSession();
    if (stored) {
      this.token = stored.accessToken;
      this.userSignal.set(stored.user);
    }
  }

  accessToken(): string | null {
    return this.token;
  }

  isLoggedIn(): boolean {
    return this.token !== null && this.userSignal() !== null;
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/auth/login', { username, password })
      .pipe(
        tap((result) => {
          this.token = result.accessToken;
          this.userSignal.set(result.user);
          this.writeSession({ accessToken: result.accessToken, user: result.user });
        }),
      );
  }

  logout(): void {
    this.http.post('/api/auth/logout', {}).subscribe({ error: () => undefined });
    this.token = null;
    this.userSignal.set(null);
    this.clearSession();
  }

  issueStreamToken(): Observable<{ token: string; expiresIn: number }> {
    return this.http.post<{ token: string; expiresIn: number }>(
      '/api/auth/stream-token',
      {},
    );
  }

  private readSession(): StoredSession | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  private writeSession(session: StoredSession): void {
    try {
      globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignore storage failures in non-browser test environments.
    }
  }

  private clearSession(): void {
    try {
      globalThis.sessionStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures in non-browser test environments.
    }
  }
}
