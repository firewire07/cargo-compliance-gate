import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  it('returns a health payload', async () => {
    const ctx = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    const controller = ctx.get(AppController);
    expect(controller.health()).toEqual({ status: 'ok', service: 'api-gateway' });
  });
});
