import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  /**
   * Filled in once the request is authenticated, which is why it is the one
   * mutable field here. P02's guard calls `setUserId` after verifying the token;
   * until then every log line for the request simply omits it.
   */
  userId?: string;
}

/**
 * Carries the request id from the middleware that mints it to everything that
 * runs underneath — the logger, the exception filter, and later the audit
 * writer — without threading a parameter through every function signature.
 *
 * `AsyncLocalStorage` rather than a request-scoped provider: request scoping in
 * Nest re-instantiates the whole dependency subtree per request, which is a
 * heavy price for one string, and it does not reach code outside the DI graph.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  /**
   * The current request id, or `'-'` outside a request.
   *
   * Returning a placeholder rather than throwing is deliberate: this is read by
   * the logger, and a logger that throws during startup — or inside a
   * background job, where there is no request — would be worse than a log line
   * with a dash in it.
   */
  requestId(): string {
    return this.storage.getStore()?.requestId ?? '-';
  }

  /**
   * Attaches the authenticated user to every subsequent log line for this
   * request (AC1's "user ID where known"). A no-op outside a request.
   */
  setUserId(userId: string): void {
    const context = this.storage.getStore();

    if (context !== undefined) {
      context.userId = userId;
    }
  }

  userId(): string | undefined {
    return this.storage.getStore()?.userId;
  }
}
