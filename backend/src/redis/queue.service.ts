import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor } from 'bullmq';

import { TypedConfigService } from '../config/index.js';

/** Where a job goes once BullMQ has given up on it (AC3). */
export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface DeadLetterPayload {
  queue: string;
  jobName: string;
  jobId: string | undefined;
  data: unknown;
  attemptsMade: number;
  failedReason: string;
  failedAt: string;
}

/**
 * Creates queues and workers, and owns closing them.
 *
 * BullMQ cannot share `RedisService`'s connection: it requires
 * `maxRetriesPerRequest: null` for its blocking commands, which is the opposite
 * of what a cache wants. So this makes its own, and the two are configured for
 * their own jobs rather than compromised into one.
 *
 * **No jobs are defined here.** The story that needs a job defines it — SLA
 * timers, notification fan-out — and calls `registerWorker`.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connection: ConnectionOptions;
  private readonly defaultJobOptions: JobsOptions;

  /** Shutting down twice must be a no-op, not a crash. */
  private closed = false;

  constructor(config: TypedConfigService) {
    const url = new URL(config.get('REDIS_URL'));

    this.connection = {
      host: url.hostname,
      port: Number(url.port === '' ? 6379 : url.port),
      // Required by BullMQ: its blocking reads must not be retried out from
      // under it. This is why the cache connection cannot be reused.
      maxRetriesPerRequest: null,
      ...(url.password === '' ? {} : { password: url.password }),
    };

    this.defaultJobOptions = {
      attempts: config.get('QUEUE_MAX_ATTEMPTS'),
      backoff: { type: 'exponential', delay: config.get('QUEUE_BACKOFF_MS') },
      // Keep a short tail for debugging; a queue that keeps every completed job
      // forever is a memory leak with a schedule.
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1_000 },
    };
  }

  /** The queue with this name, created on first use. */
  queue(name: string): Queue {
    const existing = this.queues.get(name);

    if (existing !== undefined) {
      return existing;
    }

    const created = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: this.defaultJobOptions,
    });

    this.queues.set(name, created);

    return created;
  }

  /** Enqueues one job. */
  async add(
    queueName: string,
    jobName: string,
    data: unknown,
    options?: JobsOptions,
  ): Promise<void> {
    await this.queue(queueName).add(jobName, data, options);
  }

  /**
   * Starts a worker, and wires the dead-letter behaviour AC3 asks for.
   *
   * BullMQ retries with backoff on its own; what it does not do is move a job
   * that has exhausted its attempts somewhere a human will find it. The
   * `failed` handler here checks whether this was the last attempt and, if so,
   * writes the job onto the dead-letter queue with the reason attached.
   */
  registerWorker<TData = unknown, TResult = unknown>(
    queueName: string,
    processor: Processor<TData, TResult>,
    concurrency = 1,
  ): Worker<TData, TResult> {
    const worker = new Worker<TData, TResult>(queueName, processor, {
      connection: this.connection,
      concurrency,
    });

    worker.on('failed', (job, error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const attemptsAllowed = job?.opts.attempts ?? 1;

      this.logger.warn(
        `Job ${jobLabel(queueName, job?.name, job?.id)} failed on attempt ` +
          `${String(attemptsMade)} of ${String(attemptsAllowed)}: ${error.message}`,
      );

      if (job === undefined || attemptsMade < attemptsAllowed) {
        return;
      }

      const payload: DeadLetterPayload = {
        queue: queueName,
        jobName: job.name,
        jobId: job.id,
        data: job.data,
        attemptsMade,
        failedReason: error.message,
        failedAt: new Date().toISOString(),
      };

      this.logger.error(
        `Job ${jobLabel(queueName, job.name, job.id)} exhausted its retries; dead-lettering`,
      );

      // Never retried and never dead-lettered again — this is the terminus.
      void this.queue(DEAD_LETTER_QUEUE)
        .add(`${queueName}:${job.name}`, payload, { attempts: 1 })
        .catch((deadLetterError: unknown) => {
          this.logger.error(
            `Could not dead-letter ${jobLabel(queueName, job.name, job.id)}: ${
              deadLetterError instanceof Error ? deadLetterError.message : String(deadLetterError)
            }`,
          );
        });
    });

    worker.on('error', (error: Error) => {
      this.logger.warn(`Worker on ${queueName} errored: ${error.message}`);
    });

    this.workers.push(worker);

    return worker;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Workers first: closing a queue out from under a running worker leaves it
    // holding a connection to a queue that no longer exists.
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}

function jobLabel(queue: string, name: string | undefined, id: string | undefined): string {
  return `${queue}/${name ?? 'unknown'}#${id ?? '?'}`;
}
