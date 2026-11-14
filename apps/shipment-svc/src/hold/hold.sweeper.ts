import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ShipmentEnv } from '../config/env';
import { holdSweepIntervalMs } from './hold.aggregator';
import { HoldService } from './hold.service';

@Injectable()
export class HoldSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldSweeper.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly holds: HoldService,
    private readonly config: ConfigService<ShipmentEnv, true>,
  ) {}

  onModuleInit(): void {
    const interval = holdSweepIntervalMs(this.config.get('HOLD_SWEEP_INTERVAL_MS', { infer: true }));
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.logger.log(`Hold timeout sweep every ${interval}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      await this.holds.sweep();
    } catch (err) {
      this.logger.error(
        'Hold timeout sweep failed',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
