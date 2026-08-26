import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { QueueService } from '../redis/index.js';
import { SlaClockService } from './sla-clock.service.js';

export const SLA_QUEUE = 'sla';
export const SLA_SWEEP_JOB = 'sweep';

/** Every minute. The at-risk threshold is a fraction of hours, not of seconds. */
const EVERY_MINUTE = '* * * * *';

/**
 * The scheduled evaluation US-68's AC5 asks for, on the BullMQ infrastructure
 * US-10 built and the story's own technical note names.
 *
 * A repeatable job rather than a `setInterval`, for the reason US-10 put BullMQ
 * in: with two API replicas, an interval runs the sweep twice a minute in
 * parallel. BullMQ's repeatable jobs are scheduled once in Redis, so the sweep
 * happens once however many processes are running.
 *
 * The sweep is idempotent anyway — it only ever sets a flag that is not yet set
 * — which is the belt to that braces. A scheduled job that is only correct
 * because it runs exactly once is a scheduled job waiting to be wrong.
 */
@Injectable()
export class SlaSweepWorker implements OnModuleInit {
  private readonly logger = new Logger(SlaSweepWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly clock: SlaClockService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.registerWorker(SLA_QUEUE, async () => {
      await this.clock.sweep();
    });

    // `jobId` is fixed so a restart re-registers the same schedule rather than
    // stacking a second one beside it.
    await this.queue.add(
      SLA_QUEUE,
      SLA_SWEEP_JOB,
      {},
      { repeat: { pattern: EVERY_MINUTE }, jobId: SLA_SWEEP_JOB },
    );

    this.logger.log('SLA sweep scheduled, every minute');
  }
}
