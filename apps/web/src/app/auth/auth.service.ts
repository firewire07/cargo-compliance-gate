import { Injectable, signal } from '@angular/core';
import { SessionUser, UserRole } from '../models/user.model';

// Seam for T7: replace this local placeholder session with a real gateway JWT.
const STORAGE_KEY = 'ccg.dev-session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<SessionUser | null>(this.readSession());
  readonly user = this.userSignal.asReadonly();

  isLoggedIn(): boolean {
    return this.userSignal() !== null;
  }

  login(username: string, role: UserRole): void {
    const session: SessionUser = { username: username.trim(), role };
    this.writeSession(session);
    this.userSignal.set(session);
  }

  logout(): void {
    this.clearSession();
    this.userSignal.set(null);
  }

  private readSession(): SessionUser | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  }

  private writeSession(session: SessionUser): void {
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
