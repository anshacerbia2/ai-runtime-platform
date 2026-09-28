import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaGatewayRepository } from './prisma-gateway.repository.js';

const SCAN_MS = 5_000;

/** Bounded suspicion scan; PostgreSQL transactions perform the actual fence. */
@Injectable()
export class GatewayRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayRecoveryWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private failureReported = false;

  constructor(private readonly repository: PrismaGatewayRepository) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SCAN_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.running;
  }

  private tick() {
    if (this.running) {
      return this.running;
    }
    this.running = this.repository
      .recoverExpiredInvocations()
      .then((count) => {
        if (count) {
          this.logger.warn(
            `Fenced ${count} expired gateway provider attempt(s).`,
          );
        }
        this.failureReported = false;
      })
      .catch(() => {
        if (!this.failureReported) {
          this.logger.warn('Gateway recovery scan failed; retrying.');
          this.failureReported = true;
        }
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
