import { ConsoleLogger, type LoggerService } from '@nestjs/common';

import { RequestContextService } from '../request-context/request-context.service.js';

/**
 * Nest's console logger, with the request id appended to every line (AC5).
 *
 * This is what makes "attached to every related log line" true rather than
 * aspirational: any `Logger` anywhere in the app — a service, a guard, the
 * exception filter — routes through here, so nothing has to remember to include
 * the id. Outside a request the id is `-`.
 *
 * **US-9 replaces this with structured JSON logging.** It should read the same
 * `RequestContextService` rather than inventing a second source of truth; the
 * context plumbing is deliberately separate from the formatting for exactly
 * that reason.
 */
export class ContextLogger extends ConsoleLogger implements LoggerService {
  constructor(private readonly requestContext: RequestContextService) {
    super();
  }

  private tag(message: unknown): string {
    return `[${this.requestContext.requestId()}] ${typeof message === 'string' ? message : JSON.stringify(message)}`;
  }

  override log(message: unknown, ...rest: unknown[]): void {
    super.log(this.tag(message), ...(rest as string[]));
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(this.tag(message), ...(rest as string[]));
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(this.tag(message), ...(rest as string[]));
  }

  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(this.tag(message), ...(rest as string[]));
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(this.tag(message), ...(rest as string[]));
  }
}
