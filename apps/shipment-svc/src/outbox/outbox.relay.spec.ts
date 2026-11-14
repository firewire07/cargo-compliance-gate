import { Logger } from '@nestjs/common';
import { EventEnvelope, SHIPMENT_SUBMITTED } from '@cargo-compliance-gate/contracts';
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
  correlationId: 'corr-1',
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
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
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
          headers: { 'x-correlation-id': 'corr-1' },
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

  it('sends the outbox correlationId column as the x-correlation-id header', async () => {
    prisma.outbox.findMany.mockResolvedValue([
      { ...row, correlationId: 'corr-from-column' },
    ]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({});

    await relay.poll();

    const message = kafka.send.mock.calls[0][0].messages[0];
    expect(message.headers).toEqual({ 'x-correlation-id': 'corr-from-column' });
    // Envelope wire format is unchanged.
    expect(JSON.parse(message.value)).toEqual(envelope);
  });

  it('falls back to the envelope correlationId for rows written before the column existed', async () => {
    prisma.outbox.findMany.mockResolvedValue([{ ...row, correlationId: null }]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({});

    await relay.poll();

    expect(kafka.send.mock.calls[0][0].messages[0].headers).toEqual({
      'x-correlation-id': 'corr-1',
    });
  });

  it('generates a correlation id when neither the row nor the envelope has one', async () => {
    prisma.outbox.findMany.mockResolvedValue([
      {
        ...row,
        correlationId: null,
        payload: { ...envelope, correlationId: '' },
      },
    ]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({});

    await relay.poll();

    expect(
      kafka.send.mock.calls[0][0].messages[0].headers['x-correlation-id'],
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs the correlationId of every published row', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    prisma.outbox.findMany.mockResolvedValue([row]);
    kafka.send.mockResolvedValue(undefined);
    prisma.outbox.update.mockResolvedValue({});

    await relay.poll();

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(
      expect.objectContaining({
        event: 'outbox.published',
        correlationId: 'corr-1',
        eventId: 'evt-1',
      }),
    );
  });
});
