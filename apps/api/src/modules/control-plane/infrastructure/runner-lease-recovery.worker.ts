import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { RunnerLeaseRecoveryService } from '../application/runner-lease-recovery.service.js';
import { RunnerCoordinationService } from '../application/runner-coordination.service.js';

const SCAN_MS = 5_000;

@Injectable()
export class RunnerLeaseRecoveryWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RunnerLeaseRecoveryWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private failureReported = false;

  constructor(
    private readonly recovery: RunnerLeaseRecoveryService,
    private readonly coordination: RunnerCoordinationService,
  ) {}

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
    this.running = this.coordination
      .recover()
      .then(
        async (epochFences) => epochFences + (await this.recovery.recover()),
      )
      .then((fenced) => {
        if (fenced) {
          this.logger.warn(
            `Fenced ${fenced} runner assignment(s) with missing lease authority.`,
          );
        }
        this.failureReported = false;
      })
      .catch(() => {
        if (!this.failureReported) {
          this.logger.warn('Runner lease recovery scan failed; retrying.');
          this.failureReported = true;
        }
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
