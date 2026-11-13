import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { AccessTokenPayload } from './jwt';

export const STREAM_TOKEN_TTL_SEC = 60;

type StreamTokenRecord = {
  payload: AccessTokenPayload;
  expiresAt: number;
  used: boolean;
};

@Injectable()
export class StreamTokenStore {
  private readonly tokens = new Map<string, StreamTokenRecord>();

  issue(payload: AccessTokenPayload, now = Date.now()): { token: string; expiresIn: number } {
    this.prune(now);
    const token = randomUUID();
    this.tokens.set(token, {
      payload,
      expiresAt: now + STREAM_TOKEN_TTL_SEC * 1000,
      used: false,
    });
    return { token, expiresIn: STREAM_TOKEN_TTL_SEC };
  }

  /** Single-use: returns the payload once, then the token cannot be reused. */
  consume(token: string, now = Date.now()): AccessTokenPayload | null {
    const record = this.tokens.get(token);
    if (!record || record.used || record.expiresAt <= now) {
      if (record) {
        this.tokens.delete(token);
      }
      return null;
    }
    record.used = true;
    this.tokens.delete(token);
    return record.payload;
  }

  private prune(now: number): void {
    for (const [token, record] of this.tokens) {
      if (record.used || record.expiresAt <= now) {
        this.tokens.delete(token);
      }
    }
  }
}
