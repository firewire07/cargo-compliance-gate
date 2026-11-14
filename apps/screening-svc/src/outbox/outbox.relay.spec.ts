import { Logger } from '@nestjs/common';
import {
  EventEnvelope,
  SCREENING_CHECKED,
  SCREENING_EVENTS_TOPIC,
} from '@cargo-compliance-gate/contracts';
import { KafkaProducer } from '../kafka/kafka.producer';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelay } from './outbox.relay';

const envelope: EventEnvelope = {
  id: 'evt-s1',
  type: SCREENING_CHECKED,
  schemaVersion: 1,
  occurredAt: '2026-11-14T08:00:00.000Z',
  correlationId: 'corr-env',
  awb: '020-12345675',
  shipmentVersion: 1,
  payload: { check: 'DG', outcome: 'PASS' },
};

const row = {
  id: 'evt-s1',
  aggregateId: '020-12345675',
  type: SCREENING_CHECKED,
  payload: envelope,
  correlationId: 'corr-col',
  createdAt: new Date('2026-11-14T08:00:00.000Z'),
  sentAt: null,
};

describe('screening OutboxRelay', () => {
  const prisma = { outbox: { findMany: jest.fn(), update: jest.fn() } };
  const kafka = { send: jest.fn() };
  let relay: OutboxRelay;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({});
    relay = new OutboxRelay(
      prisma as unknown as PrismaService,
      kafka as unknown as KafkaProducer,
    );
  });

  it('publishes to screening.events with the x-correlation-id header from the row', async () => {
    prisma.outbox.findMany.mockResolvedValue([row]);

    await relay.poll();

    expect(kafka.send).toHaveBeenCalledWith({
      topic: SCREENING_EVENTS_TOPIC,
      messages: [
        {
          key: '020-12345675',
          value: JSON.stringify(envelope),
          headers: { 'x-correlation-id': 'corr-col' },
        },
      ],
    });
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'evt-s1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('falls back to the envelope correlationId when the column is empty', async () => {
    prisma.outbox.findMany.mockResolvedValue([{ ...row, correlationId: null }]);

    await relay.poll();

    expect(kafka.send.mock.calls[0][0].messages[0].headers).toEqual({
      'x-correlation-id': 'corr-env',
    });
  });
});
