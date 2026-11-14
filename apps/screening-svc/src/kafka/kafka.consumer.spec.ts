import { ScreeningHandler } from '../screening/screening.handler';
import { KafkaConsumer } from './kafka.consumer';

describe('screening KafkaConsumer', () => {
  it('passes decoded Kafka headers (incl. x-correlation-id) to the handler, then commits', async () => {
    const handler = { handleMessage: jest.fn().mockResolvedValue({ status: 'processed' }) };
    const consumer = new KafkaConsumer(
      handler as unknown as ScreeningHandler,
      { get: jest.fn() } as never,
    );
    const commitOffsets = jest.fn().mockResolvedValue(undefined);
    (consumer as unknown as { consumer: unknown }).consumer = { commitOffsets };

    await (
      consumer as unknown as { onMessage(p: unknown): Promise<void> }
    ).onMessage({
      topic: 'shipment.events',
      partition: 1,
      message: {
        offset: '41',
        value: Buffer.from('{"id":"evt-1"}'),
        headers: { 'x-correlation-id': Buffer.from('corr-kafka') },
      },
    });

    expect(handler.handleMessage).toHaveBeenCalledWith('{"id":"evt-1"}', {
      'x-correlation-id': 'corr-kafka',
    });
    expect(commitOffsets).toHaveBeenCalledWith([
      { topic: 'shipment.events', partition: 1, offset: '42' },
    ]);
  });
});
