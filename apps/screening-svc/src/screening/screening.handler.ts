import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CheckOutcome,
  CheckType,
  Prisma,
} from '../../generated/prisma';
import {
  EventEnvelope,
  SCREENED_SHIPMENT_TYPES,
  SCREENING_CHECKED,
  ShipmentEventPayload,
  CORRELATION_ID_HEADER,
  buildEventEnvelope,
  logLine,
  resolveCorrelationId,
} from '@cargo-compliance-gate/contracts';
import { ConfigService } from '@nestjs/config';
import type { ScreeningEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { checkDg } from '../rules/dg';
import { checkEmbargo } from '../rules/embargo';
import { parseSanctionsMode, screenSanctions } from '../rules/sanctions';
import { RuleResult } from '../rules/types';

export type HandleResult =
  | { status: 'ignored'; reason: string }
  | { status: 'skipped'; eventId: string }
  | { status: 'processed'; eventId: string; awb: string; results: RuleResult[] };

@Injectable()
export class ScreeningHandler {
  private readonly logger = new Logger(ScreeningHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ScreeningEnv, true>,
  ) {}

  async handleMessage(
    raw: string,
    headers?: Record<string, string | undefined>,
  ): Promise<HandleResult> {
    let envelope: EventEnvelope<ShipmentEventPayload>;
    try {
      envelope = JSON.parse(raw) as EventEnvelope<ShipmentEventPayload>;
    } catch {
      this.logger.warn(
        logLine('shipment-event.malformed', {
          correlationId: resolveCorrelationId(headers?.[CORRELATION_ID_HEADER]),
        }),
      );
      return { status: 'ignored', reason: 'malformed' };
    }
    return this.handle(envelope, headers);
  }

  async handle(
    envelope: EventEnvelope<ShipmentEventPayload>,
    headers?: Record<string, string | undefined>,
  ): Promise<HandleResult> {
    if (!envelope?.id || !envelope.type) {
      return { status: 'ignored', reason: 'missing-id-or-type' };
    }
    if (
      !SCREENED_SHIPMENT_TYPES.includes(
        envelope.type as (typeof SCREENED_SHIPMENT_TYPES)[number],
      )
    ) {
      return { status: 'ignored', reason: `type:${envelope.type}` };
    }

    const payload = envelope.payload ?? {};
    const awb = envelope.awb || payload.awb;
    const shipmentVersion = envelope.shipmentVersion ?? 1;
    if (!awb) {
      return { status: 'ignored', reason: 'missing-awb' };
    }

    // Kafka header (T12) first, then the envelope field, then a fresh UUID.
    const correlationId = resolveCorrelationId(
      headers?.[CORRELATION_ID_HEADER],
      envelope.correlationId,
    );

    const results = this.evaluate(payload);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.processedEvent.createMany({
        data: [{ eventId: envelope.id }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        return 'skipped' as const;
      }

      for (const result of results) {
        await tx.screeningResult.create({
          data: {
            awb,
            shipmentVersion,
            check: result.check as CheckType,
            outcome: result.outcome as CheckOutcome,
            ruleVersion: result.ruleVersion,
            score: result.score ?? null,
            reasons: result.reasons as Prisma.InputJsonValue,
            inputs: result.inputs as Prisma.InputJsonValue,
          },
        });

        const eventId = randomUUID();
        const outbound = buildEventEnvelope({
          id: eventId,
          type: SCREENING_CHECKED,
          correlationId,
          awb,
          shipmentVersion,
          payload: {
            check: result.check,
            outcome: result.outcome,
            ruleVersion: result.ruleVersion,
            score: result.score,
            reasons: result.reasons,
          },
        });

        await tx.outbox.create({
          data: {
            id: eventId,
            aggregateId: awb,
            type: SCREENING_CHECKED,
            payload: outbound as unknown as Prisma.InputJsonValue,
            correlationId,
          },
        });
      }

      return 'processed' as const;
    });

    if (outcome === 'skipped') {
      this.logger.log(
        logLine('screening.skipped-duplicate', {
          correlationId,
          eventId: envelope.id,
          awb,
        }),
      );
      return { status: 'skipped', eventId: envelope.id };
    }

    this.logger.log(
      logLine('screening.completed', {
        correlationId,
        eventId: envelope.id,
        awb,
        shipmentVersion,
        results: Object.fromEntries(
          results.map((item) => [item.check, item.outcome]),
        ),
      }),
    );
    return { status: 'processed', eventId: envelope.id, awb, results };
  }

  evaluate(payload: ShipmentEventPayload): RuleResult[] {
    return [
      checkDg({
        unNumber: payload.unNumber,
        aircraftType: payload.aircraftType,
      }),
      checkEmbargo({
        origin: payload.origin,
        destination: payload.destination,
        routing: payload.routing,
      }),
      screenSanctions(
        {
          shipper: payload.shipper,
          consignee: payload.consignee,
          origin: payload.origin,
          destination: payload.destination,
          routing: payload.routing,
          goodsDescription: payload.goodsDescription,
          hsCode: payload.hsCode,
        },
        parseSanctionsMode(this.config.get('SANCTIONS_MODE', { infer: true })),
      ),
    ];
  }
}
