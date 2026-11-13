import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type StatusEvent = {
  id: string;
  type: string;
  awb: string;
  shipmentVersion?: number;
  occurredAt?: string;
  correlationId?: string;
  payload: unknown;
};

@Injectable()
export class StreamHub {
  private readonly subscribers = new Map<string, (event: StatusEvent) => void>();

  subscribe(handler: (event: StatusEvent) => void): string {
    const id = randomUUID();
    this.subscribers.set(id, handler);
    return id;
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  publish(event: StatusEvent): void {
    for (const handler of this.subscribers.values()) {
      try {
        handler(event);
      } catch {
        // drop a broken subscriber write; close handler removes it
      }
    }
  }
}
