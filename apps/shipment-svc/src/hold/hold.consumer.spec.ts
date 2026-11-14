import { HoldConsumer } from './hold.consumer';
import { HoldService } from './hold.service';

describe('HoldConsumer', () => {
  function build() {
    const holds = { handleMessage: jest.fn().mockResolvedValue({ status: 'pending' }) };
    const consumer = new HoldConsumer(
      holds as unknown as HoldService,
      { get: jest.fn() } as never,
    );
    const commitOffsets = jest.fn().mockResolvedValue(undefined);
    (consumer as unknown as { consumer: unknown }).consumer = { commitOffsets };
    const onMessage = (p: unknown) =>
      (consumer as unknown as { onMessage(p: unknown): Promise<void> }).onMessage(p);
    return { holds, commitOffsets, onMessage };
  }

  it('reads the x-correlation-id Kafka header and passes it to the hold service', async () => {
    const { holds, commitOffsets, onMessage } = build();

    await onMessage({
      topic: 'screening.events',
      partition: 0,
      message: {
        offset: '7',
        value: Buffer.from('{"id":"evt-1"}'),
        headers: { 'x-correlation-id': Buffer.from('corr-kafka') },
      },
    });

    expect(holds.handleMessage).toHaveBeenCalledWith('{"id":"evt-1"}', 'corr-kafka');
    expect(commitOffsets).toHaveBeenCalledWith([
      { topic: 'screening.events', partition: 0, offset: '8' },
    ]);
  });

  it('passes undefined when the header is missing (service falls back to the envelope)', async () => {
    const { holds, onMessage } = build();

    await onMessage({
      topic: 'screening.events',
      partition: 0,
      message: { offset: '1', value: Buffer.from('{}'), headers: {} },
    });

    expect(holds.handleMessage).toHaveBeenCalledWith('{}', undefined);
  });
});
