import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  CORRELATION_ID_HEADER,
  EventEnvelope,
  SHIPMENT_EVENTS_TOPIC,
  logLine,
  resolveCorrelationId,
} from '@cargo-compliance-gate/contracts';
export { SHIPMENT_EVENTS_TOPIC };
import { KafkaProducer } from '../kafka/kafka.producer';
import { PrismaService } from '../prisma/prisma.service';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaProducer,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const rows = await this.prisma.outbox.findMany({
        where: { sentAt: null },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const row of rows) {
        const envelope = row.payload as EventEnvelope;
        // Column first (T12), then the envelope field (rows written before the
        // migration), then a fresh UUID so every message carries the header.
        const correlationId = resolveCorrelationId(
          row.correlationId,
          envelope?.correlationId,
        );
        const topic = row.topic || SHIPMENT_EVENTS_TOPIC;
        await this.kafka.send({
          topic,
          messages: [
            {
              key: row.aggregateId,
              value: JSON.stringify(envelope),
              headers: { [CORRELATION_ID_HEADER]: correlationId },
            },
          ],
        });
        // Mark sent only after publish. If this update fails, the row is
        // published again (at-least-once); consumers must be idempotent.
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: { sentAt: new Date() },
        });
        this.logger.log(
          logLine('outbox.published', {
            correlationId,
            eventId: row.id,
            type: row.type,
            topic,
            awb: row.aggregateId,
          }),
        );
      }
    } catch (err) {
      this.logger.error(
        'Outbox relay poll failed',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
