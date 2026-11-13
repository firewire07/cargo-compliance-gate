import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Prisma,
  ShipmentStatus,
} from '../../generated/prisma';
import {
  EventEnvelope,
  HOLD_EVENTS_TOPIC,
  SCREENING_CHECKED,
  SHIPMENT_CLEARED,
  SHIPMENT_HELD,
  ScreeningCheckedPayload,
} from '../events/envelope';
import { PrismaService } from '../prisma/prisma.service';
import {
  EXPECTED_CHECKS,
  ReceivedCheck,
  allExpectedReceived,
  alreadyReceived,
  decide,
  isStale,
  timeoutReasons,
} from './hold.aggregator';

export type ApplyResult =
  | { status: 'ignored'; reason: string }
  | { status: 'skipped'; eventId: string }
  | { status: 'stale'; eventId: string }
  | { status: 'pending'; awb: string }
  | { status: 'decided'; awb: string; decision: 'HELD' | 'CLEARED' };

@Injectable()
export class HoldService {
  private readonly logger = new Logger(HoldService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleMessage(raw: string): Promise<ApplyResult> {
    let envelope: EventEnvelope<ScreeningCheckedPayload>;
    try {
      envelope = JSON.parse(raw) as EventEnvelope<ScreeningCheckedPayload>;
    } catch {
      this.logger.warn('Ignoring malformed screening event');
      return { status: 'ignored', reason: 'malformed' };
    }
    return this.applyScreeningResult(envelope);
  }

  async applyScreeningResult(
    envelope: EventEnvelope<ScreeningCheckedPayload>,
  ): Promise<ApplyResult> {
    if (!envelope?.id || envelope.type !== SCREENING_CHECKED) {
      return { status: 'ignored', reason: `type:${envelope?.type}` };
    }
    const check = envelope.payload?.check;
    const outcome = envelope.payload?.outcome;
    if (!envelope.awb || !check || (outcome !== 'PASS' && outcome !== 'HIT')) {
      return { status: 'ignored', reason: 'incomplete-payload' };
    }

    const incoming: ReceivedCheck = {
      check,
      outcome,
      reasons: envelope.payload?.reasons ?? [],
      ruleVersion: envelope.payload?.ruleVersion,
      score: envelope.payload?.score,
      eventId: envelope.id,
    };

    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.processedEvent.createMany({
        data: [{ eventId: envelope.id }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        this.logger.log(`Skipping already processed event ${envelope.id}`);
        return { status: 'skipped', eventId: envelope.id };
      }

      const shipment = await tx.shipment.findUnique({
        where: { awb: envelope.awb },
      });
      if (!shipment) {
        this.logger.warn(`No shipment for AWB ${envelope.awb}`);
        return { status: 'ignored', reason: 'missing-shipment' };
      }
      if (isStale(envelope.shipmentVersion, shipment.version)) {
        this.logger.log(
          `Ignoring stale ${check} for ${envelope.awb} v${envelope.shipmentVersion} (current v${shipment.version})`,
        );
        return { status: 'stale', eventId: envelope.id };
      }

      const pending = await tx.pendingCheck.findUnique({
        where: {
          awb_shipmentVersion: {
            awb: envelope.awb,
            shipmentVersion: envelope.shipmentVersion,
          },
        },
      });
      if (!pending || pending.decidedAt) {
        return { status: 'ignored', reason: pending ? 'already-decided' : 'no-pending' };
      }

      const received = [...(pending.received as ReceivedCheck[])];
      if (!alreadyReceived(received, check)) {
        received.push(incoming);
        await tx.pendingCheck.update({
          where: { id: pending.id },
          data: { received: received as unknown as Prisma.InputJsonValue },
        });
      }

      if (!allExpectedReceived(pending.expected, received)) {
        return { status: 'pending', awb: envelope.awb };
      }

      const decision = decide(received);
      await this.persistDecision(
        tx,
        pending.awb,
        pending.shipmentVersion,
        pending.id,
        decision.status,
        decision.reasons,
        received,
        envelope.correlationId || pending.correlationId,
      );
      return {
        status: 'decided',
        awb: envelope.awb,
        decision: decision.status,
      };
    });
  }

  async sweep(now = new Date()): Promise<number> {
    const overdue = await this.prisma.pendingCheck.findMany({
      where: { decidedAt: null, deadline: { lte: now } },
    });
    let decided = 0;
    for (const row of overdue) {
      const applied = await this.applyTimeout(row.id);
      if (applied) {
        decided += 1;
      }
    }
    return decided;
  }

  private async applyTimeout(pendingId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.pendingCheck.findUnique({
        where: { id: pendingId },
      });
      if (!pending || pending.decidedAt) {
        return false;
      }
      const shipment = await tx.shipment.findUnique({
        where: { awb: pending.awb },
      });
      if (!shipment || shipment.version !== pending.shipmentVersion) {
        await tx.pendingCheck.update({
          where: { id: pending.id },
          data: { decidedAt: new Date() },
        });
        return false;
      }
      if (
        shipment.status === ShipmentStatus.HELD ||
        shipment.status === ShipmentStatus.CLEARED ||
        shipment.status === ShipmentStatus.RELEASED
      ) {
        await tx.pendingCheck.update({
          where: { id: pending.id },
          data: { decidedAt: new Date() },
        });
        return false;
      }

      const received = pending.received as ReceivedCheck[];
      const reasons = timeoutReasons(pending.expected, received);
      await this.persistDecision(
        tx,
        pending.awb,
        pending.shipmentVersion,
        pending.id,
        'HELD',
        reasons,
        received,
        pending.correlationId,
      );
      this.logger.log(
        `Fail-closed timeout for ${pending.awb} v${pending.shipmentVersion}: ${reasons.join(', ')}`,
      );
      return true;
    });
  }

  private async persistDecision(
    tx: Prisma.TransactionClient,
    awb: string,
    shipmentVersion: number,
    pendingId: string,
    status: 'HELD' | 'CLEARED',
    reasons: string[],
    received: ReceivedCheck[],
    correlationId: string,
  ): Promise<void> {
    const shipmentStatus =
      status === 'HELD' ? ShipmentStatus.HELD : ShipmentStatus.CLEARED;
    await tx.shipment.update({
      where: { awb },
      data: { status: shipmentStatus },
    });
    await tx.pendingCheck.update({
      where: { id: pendingId },
      data: { decidedAt: new Date(), received: received as unknown as Prisma.InputJsonValue },
    });
    if (status === 'HELD') {
      await tx.hold.create({
        data: {
          awb,
          shipmentVersion,
          reasons: reasons as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const type = status === 'HELD' ? SHIPMENT_HELD : SHIPMENT_CLEARED;
    const eventId = randomUUID();
    const envelope: EventEnvelope<{
      status: string;
      reasons: string[];
      checks: ReceivedCheck[];
    }> = {
      id: eventId,
      type,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId,
      awb,
      shipmentVersion,
      payload: { status, reasons, checks: received },
    };
    await tx.outbox.create({
      data: {
        id: eventId,
        aggregateId: awb,
        type,
        topic: HOLD_EVENTS_TOPIC,
        payload: envelope as unknown as Prisma.InputJsonValue,
      },
    });
  }

  listHolds() {
    return this.prisma.hold.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
