import { toast as sonner } from 'sonner';

import i18n from '@/i18n';
import { ApiRequestError } from './api-client';

/**
 * The one way this app tells you something happened — US-32.
 *
 * A wrapper rather than calling `sonner` directly, for three reasons that all
 * come down to consistency being the point of feedback:
 *
 *   1. **Success dismisses itself; failure does not.** A confirmation you missed
 *      costs nothing. An error you missed means you think your reply sent.
 *   2. **Failure offers a retry** wherever the caller can supply one, so the fix
 *      is in the message rather than somewhere the user has to go and find.
 *   3. **The copy comes from i18n**, never a literal, because the platform is
 *      bilingual and a toast is the easiest place in a codebase to forget that.
 */

/** Seconds Undo stays available. Long enough to react, short enough to commit. */
const UNDO_SECONDS = 6;

/**
 * Confirms an action, then gets out of the way — AC1.
 *
 * The message is the past tense of the button that caused it: "Publish"
 * produces "Published". An action keeping its name through the whole flow is
 * how somebody learns their way around.
 */
export function toastSuccess(message: string, description?: string): void {
  sonner.success(message, {
    ...(description === undefined ? {} : { description }),
    duration: 4000,
  });
}

/**
 * Reports a failure and **stays until dismissed** — AC2.
 *
 * Takes the error rather than a string so the message can come from the
 * envelope's code, and so the request id is available to whoever has to chase
 * it. Never says "something went wrong" when the server said something better.
 */
export function toastError(
  error: unknown,
  options: { fallback?: string; onRetry?: () => void } = {},
): void {
  const apiError = error instanceof ApiRequestError ? error : undefined;

  const message =
    apiError?.code === 'NETWORK_ERROR'
      ? i18n.t('states.errorOffline')
      : (options.fallback ?? apiError?.message ?? i18n.t('states.errorBody'));

  sonner.error(message, {
    // `Infinity` rather than a long timeout: a failure that vanished while the
    // user was reading something else is a failure they will never know about.
    duration: Infinity,
    ...(apiError?.requestId === undefined
      ? {}
      : { description: `${i18n.t('states.reference')} ${apiError.requestId}` }),
    ...(options.onRetry === undefined
      ? {}
      : { action: { label: i18n.t('states.retry'), onClick: options.onRetry } }),
  });
}

/**
 * Confirms something that can be taken back — AC3.
 *
 * Undo only where it is honest. Offering it for something irreversible, or for
 * something that only *sometimes* reverses, is worse than not offering it: the
 * user stops trusting the one place the product promises safety.
 */
export function toastUndo(message: string, onUndo: () => void): void {
  sonner.success(message, {
    duration: UNDO_SECONDS * 1000,
    action: { label: i18n.t('common.undo'), onClick: onUndo },
  });
}

/**
 * A toast tied to a promise — the shape most mutations want.
 *
 * One call covers all three states, which stops the pending toast being
 * forgotten on the paths where somebody only remembered success and failure.
 */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { loading: string; success: string; error?: string },
): void {
  sonner.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: (error: unknown) =>
      error instanceof ApiRequestError
        ? (messages.error ?? error.message)
        : (messages.error ?? i18n.t('states.errorBody')),
  });
}

/** Dismisses everything. For a route change that makes stale feedback wrong. */
export function dismissToasts(): void {
  sonner.dismiss();
}
