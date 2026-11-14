import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEnvelope, SCREENING_EVENTS_TOPIC } from '@cargo-compliance-gate/contracts';
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
        await this.kafka.send({
          topic: SCREENING_EVENTS_TOPIC,
          messages: [
            {
              key: row.aggregateId,
              value: JSON.stringify(envelope),
              headers: { correlationId: envelope.correlationId },
            },
          ],
        });
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: { sentAt: new Date() },
        });
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
