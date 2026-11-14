import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Prisma,
  ShipmentStatus,
} from '../../generated/prisma';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../auth/actor';
import {
  EventActor,
  EventEnvelope,
  HOLD_CHECKLIST_UPDATED,
  HOLD_EVENTS_TOPIC,
  HOLD_RELEASE_APPROVED,
  HOLD_RELEASE_REJECTED,
  HOLD_RELEASE_REQUESTED,
  SCREENING_CHECKED,
  SHIPMENT_CLEARED,
  SHIPMENT_HELD,
  SHIPMENT_RELEASED,
  ScreeningCheckedPayload,
  buildEventEnvelope,
} from '@cargo-compliance-gate/contracts';
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
import {
  ChecklistItem,
  checklistComplete,
  defaultChecklist,
  mergeChecklist,
} from './hold.checklist';

export type ApplyResult =
  | { status: 'ignored'; reason: string }
  | { status: 'skipped'; eventId: string }
  | { status: 'stale'; eventId: string }
  | { status: 'pending'; awb: string }
  | { status: 'decided'; awb: string; decision: 'HELD' | 'CLEARED' };

@Injectable()
export class HoldService {
  private readonly logger = new Logger(HoldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async updateChecklist(
    awb: string,
    updates: Array<{ id: string; done: boolean; note?: string }>,
    actor: Actor,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { shipment, hold } = await this.requireOpenHold(tx, awb);
      const current = (hold.checklist as ChecklistItem[]) ?? defaultChecklist();
      const checklist = mergeChecklist(current, updates);
      const updated = await tx.hold.update({
        where: { id: hold.id },
        data: { checklist: checklist as unknown as Prisma.InputJsonValue },
      });
      await this.writeDomainEvent(tx, {
        type: HOLD_CHECKLIST_UPDATED,
        awb,
        shipmentVersion: shipment.version,
        correlationId,
        actor,
        payload: { checklist, actor },
      });
      return updated;
    });
  }

  async requestRelease(awb: string, actor: Actor, correlationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { shipment, hold } = await this.requireOpenHold(tx, awb);
      if (hold.releaseApprovedBy) {
        throw new ConflictException(`Hold for ${awb} is already released`);
      }
      if (hold.releaseRequestedBy && !hold.releaseRejectedAt) {
        throw new ConflictException(`Release already requested by ${hold.releaseRequestedBy}`);
      }
      const checklist = (hold.checklist as ChecklistItem[]) ?? defaultChecklist();
      if (!checklistComplete(checklist)) {
        throw new ConflictException('Due-diligence checklist must be complete before requesting release');
      }
      const now = new Date();
      const updated = await tx.hold.update({
        where: { id: hold.id },
        data: {
          releaseRequestedBy: actor.actorId,
          releaseRequestedAt: now,
          releaseRejectedBy: null,
          releaseRejectedAt: null,
          releaseRejectionReason: null,
        },
      });
      await this.writeDomainEvent(tx, {
        type: HOLD_RELEASE_REQUESTED,
        awb,
        shipmentVersion: shipment.version,
        correlationId,
        actor,
        payload: { requestedBy: actor.actorId, actor },
      });
      return updated;
    });
  }

  async approveRelease(awb: string, actor: Actor, correlationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { shipment, hold } = await this.requireOpenHold(tx, awb);
      if (hold.releaseApprovedBy) {
        throw new ConflictException(`Hold for ${awb} is already released`);
      }
      if (!hold.releaseRequestedBy || hold.releaseRejectedAt) {
        throw new ConflictException(`No pending release request for ${awb}`);
      }
      if (hold.releaseRequestedBy === actor.actorId) {
        throw new ForbiddenException('Maker-checker: the requester cannot approve their own release');
      }
      const now = new Date();
      await tx.hold.update({
        where: { id: hold.id },
        data: {
          releaseApprovedBy: actor.actorId,
          releaseApprovedAt: now,
        },
      });
      const updatedShipment = await tx.shipment.update({
        where: { awb },
        data: { status: ShipmentStatus.RELEASED },
      });
      const payload = {
        requestedBy: hold.releaseRequestedBy,
        approvedBy: actor.actorId,
        actor,
        status: ShipmentStatus.RELEASED,
      };
      // Plan name is hold.release.approved; shipment.released is the status event.
      await this.writeDomainEvent(tx, {
        type: HOLD_RELEASE_APPROVED,
        awb,
        shipmentVersion: shipment.version,
        correlationId,
        actor,
        payload,
      });
      await this.writeDomainEvent(tx, {
        type: SHIPMENT_RELEASED,
        awb,
        shipmentVersion: shipment.version,
        correlationId,
        actor,
        payload,
      });
      return { holdId: hold.id, shipment: updatedShipment };
    });
  }

  async rejectRelease(
    awb: string,
    actor: Actor,
    reason?: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { shipment, hold } = await this.requireOpenHold(tx, awb);
      if (hold.releaseApprovedBy) {
        throw new ConflictException(`Hold for ${awb} is already released`);
      }
      if (!hold.releaseRequestedBy || hold.releaseRejectedAt) {
        throw new ConflictException(`No pending release request for ${awb}`);
      }
      const now = new Date();
      const updated = await tx.hold.update({
        where: { id: hold.id },
        data: {
          releaseRejectedBy: actor.actorId,
          releaseRejectedAt: now,
          releaseRejectionReason: reason ?? null,
        },
      });
      await this.writeDomainEvent(tx, {
        type: HOLD_RELEASE_REJECTED,
        awb,
        shipmentVersion: shipment.version,
        correlationId,
        actor,
        payload: {
          requestedBy: hold.releaseRequestedBy,
          rejectedBy: actor.actorId,
          reason: reason ?? null,
          actor,
        },
      });
      return updated;
    });
  }

  async listHolds() {
    const holds = await this.prisma.hold.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return this.withShipmentStatus(holds);
  }

  async getHold(awb: string) {
    const hold = await this.prisma.hold.findFirst({
      where: { awb },
      orderBy: { createdAt: 'desc' },
    });
    if (!hold) {
      throw new NotFoundException(`No hold for ${awb}`);
    }
    const [enriched] = await this.withShipmentStatus([hold]);
    return enriched;
  }

  private async withShipmentStatus<T extends { awb: string }>(holds: T[]) {
    if (holds.length === 0) {
      return [];
    }
    const shipments = await this.prisma.shipment.findMany({
      where: { awb: { in: [...new Set(holds.map((hold) => hold.awb))] } },
      select: { awb: true, status: true },
    });
    const statusByAwb = new Map(
      shipments.map((shipment) => [shipment.awb, shipment.status]),
    );
    return holds.map((hold) => ({
      ...hold,
      shipmentStatus: statusByAwb.get(hold.awb) ?? 'HELD',
    }));
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
          checklist: defaultChecklist() as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const type = status === 'HELD' ? SHIPMENT_HELD : SHIPMENT_CLEARED;
    await this.writeDomainEvent(tx, {
      type,
      awb,
      shipmentVersion,
      correlationId,
      payload: { status, reasons, checks: received },
    });
  }

  private async requireOpenHold(tx: Prisma.TransactionClient, awb: string) {
    const shipment = await tx.shipment.findUnique({ where: { awb } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${awb} not found`);
    }
    const hold = await tx.hold.findFirst({
      where: { awb, shipmentVersion: shipment.version },
      orderBy: { createdAt: 'desc' },
    });
    if (!hold) {
      throw new NotFoundException(`No hold for ${awb}`);
    }
    if (shipment.status === ShipmentStatus.RELEASED || hold.releaseApprovedBy) {
      throw new ConflictException(`Shipment ${awb} is already released`);
    }
    if (shipment.status !== ShipmentStatus.HELD) {
      throw new ConflictException(`Shipment ${awb} is ${shipment.status}, not HELD`);
    }
    return { shipment, hold };
  }

  private async writeDomainEvent(
    tx: Prisma.TransactionClient,
    params: {
      type: string;
      awb: string;
      shipmentVersion: number;
      correlationId?: string;
      actor?: Actor;
      payload: unknown;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const actor: EventActor | undefined = params.actor
      ? { actorId: params.actor.actorId, role: params.actor.role, at: params.actor.at }
      : undefined;
    const envelope: EventEnvelope = buildEventEnvelope({
      id: eventId,
      type: params.type,
      occurredAt,
      correlationId: params.correlationId?.trim() || eventId,
      awb: params.awb,
      shipmentVersion: params.shipmentVersion,
      actor,
      payload: params.payload,
    });
    await tx.outbox.create({
      data: {
        id: eventId,
        aggregateId: params.awb,
        type: params.type,
        topic: HOLD_EVENTS_TOPIC,
        payload: envelope as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.append(tx, {
      eventId,
      type: params.type,
      awb: params.awb,
      actor: actor?.actorId ?? 'system',
      ts: occurredAt,
      payload: params.payload,
    });
  }
}
