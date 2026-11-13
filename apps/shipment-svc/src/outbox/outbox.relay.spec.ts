import { Logger } from '@nestjs/common';
import { EventEnvelope, SHIPMENT_SUBMITTED } from '../events/envelope';
import { KafkaProducer } from '../kafka/kafka.producer';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelay, SHIPMENT_EVENTS_TOPIC } from './outbox.relay';

const envelope: EventEnvelope = {
  id: 'evt-1',
  type: SHIPMENT_SUBMITTED,
  schemaVersion: 1,
  occurredAt: '2026-11-13T08:00:00.000Z',
  correlationId: 'corr-1',
  awb: '020-12345675',
  shipmentVersion: 1,
  payload: { awb: '020-12345675' },
};

const row = {
  id: 'evt-1',
  aggregateId: '020-12345675',
  type: SHIPMENT_SUBMITTED,
  topic: SHIPMENT_EVENTS_TOPIC,
  payload: envelope,
  createdAt: new Date('2026-11-13T08:00:00.000Z'),
  sentAt: null,
};

describe('OutboxRelay', () => {
  const prisma = {
    outbox: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const kafka = {
    send: jest.fn(),
  };

  let relay: OutboxRelay;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    relay = new OutboxRelay(
      prisma as unknown as PrismaService,
      kafka as unknown as KafkaProducer,
    );
  });

  it('publishes unsent rows in createdAt order with AWB key and marks sentAt', async () => {
    prisma.outbox.findMany.mockResolvedValue([row]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({ ...row, sentAt: new Date() });

    await relay.poll();

    expect(prisma.outbox.findMany).toHaveBeenCalledWith({
      where: { sentAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    expect(kafka.send).toHaveBeenCalledWith({
      topic: SHIPMENT_EVENTS_TOPIC,
      messages: [
        {
          key: '020-12345675',
          value: JSON.stringify(envelope),
          headers: { correlationId: 'corr-1' },
        },
      ],
    });
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('does not mark sentAt if publish fails (at-least-once)', async () => {
    prisma.outbox.findMany.mockResolvedValue([row]);
    kafka.send.mockRejectedValue(new Error('broker unavailable'));

    await relay.poll();

    expect(prisma.outbox.update).not.toHaveBeenCalled();
  });

  it('publishes decision events to the topic stored on the outbox row', async () => {
    const held = {
      ...row,
      id: 'evt-held',
      type: 'shipment.held',
      topic: 'hold.events',
    };
    prisma.outbox.findMany.mockResolvedValue([held]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({ ...held, sentAt: new Date() });

    await relay.poll();

    expect(kafka.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'hold.events' }),
    );
  });
});
