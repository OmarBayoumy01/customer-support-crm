/**
 * US-32 — the agent knows whether their reply actually sent.
 *
 * AC1 success auto-dismisses · AC2 failure persists and offers retry ·
 * AC3 undo where safe · AC4 stacking is capped · AC5 announced.
 *
 * Asserted against what is handed to sonner rather than against pixels: the
 * criteria are about duration, persistence and the presence of an action, and
 * those are the arguments, not the rendering.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast as sonner } from 'sonner';

import i18n from '@/i18n';
import { ApiRequestError } from './api-client';
import { toastError, toastSuccess, toastUndo } from './toast';

type ToastOptions = {
  duration?: number;
  description?: string;
  action?: { label: string; onClick: () => void };
};

/**
 * Calls are captured into plain arrays rather than read back off a MockInstance.
 * sonner's overloads make the spy's generic parameters awkward to name, and what
 * these tests assert on is the arguments — so record those directly.
 */
type Call = [message: string, options: ToastOptions];

/**
 * sonner accepts any ReactNode as a message; everything this module sends is a
 * string, and a non-string here would itself be the bug.
 */
const asText = (message: unknown): string => (typeof message === 'string' ? message : '');

let success: Call[] = [];
let error: Call[] = [];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  success = [];
  error = [];

  vi.spyOn(sonner, 'success').mockImplementation((message, data) => {
    success.push([asText(message), (data ?? {}) as ToastOptions]);
    return '';
  });
  vi.spyOn(sonner, 'error').mockImplementation((message, data) => {
    error.push([asText(message), (data ?? {}) as ToastOptions]);
    return '';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const optionsOf = (calls: Call[]): ToastOptions => calls[0]?.[1] ?? {};

describe('AC1 — success', () => {
  test('confirms and dismisses itself', () => {
    toastSuccess('Ticket resolved');

    expect(success[0]?.[0]).toBe('Ticket resolved');
    // Finite: a confirmation you missed costs nothing.
    expect(optionsOf(success).duration).toBe(4000);
  });

  test('carries an optional second line without requiring one', () => {
    toastSuccess('Reply sent', 'The customer has been notified.');

    expect(optionsOf(success).description).toBe('The customer has been notified.');
  });
});

describe('AC2 — failure', () => {
  test('persists until dismissed', () => {
    toastError(new ApiRequestError('INTERNAL_ERROR', 'boom', 500));

    // An error that vanished while the user was reading something else is an
    // error they will never know about — and they will think their reply sent.
    expect(optionsOf(error).duration).toBe(Infinity);
  });

  test('offers a retry when the caller can supply one', () => {
    const onRetry = vi.fn();
    toastError(new ApiRequestError('INTERNAL_ERROR', 'boom', 500), { onRetry });

    const action = optionsOf(error).action;

    expect(action?.label).toBe('Try again');
    action?.onClick();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('offers no retry when there is nothing to retry with', () => {
    toastError(new ApiRequestError('FORBIDDEN', 'nope', 403));

    // A retry button that does nothing is worse than none.
    expect(optionsOf(error).action).toBeUndefined();
  });

  test('shows the request id, so it can be quoted', () => {
    toastError(new ApiRequestError('INTERNAL_ERROR', 'boom', 500, 'req-4a19'));

    expect(optionsOf(error).description).toContain('req-4a19');
  });

  test('uses the server’s own message rather than inventing one', () => {
    toastError(new ApiRequestError('CONFLICT', 'That ticket was already resolved.', 409));

    expect(error[0]?.[0]).toBe('That ticket was already resolved.');
  });

  test('an offline failure says so instead of telling you to try again', () => {
    toastError(new ApiRequestError('NETWORK_ERROR', 'x', 0));

    expect(error[0]?.[0]).toMatch(/no connection/i);
  });

  test('a non-API failure still produces something readable', () => {
    toastError(new Error('unexpected'));

    expect(error[0]?.[0]).toBeTruthy();
  });
});

describe('AC3 — undo', () => {
  test('offers Undo for several seconds and calls back', () => {
    const onUndo = vi.fn();
    toastUndo('Ticket archived', onUndo);

    const options = optionsOf(success);

    expect(options.duration).toBe(6000);
    expect(options.action?.label).toBe('Undo');

    options.action?.onClick();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  test('a plain success has no Undo — it is opt-in', () => {
    toastSuccess('Ticket resolved');

    // Offering undo for something irreversible is worse than not offering it:
    // the user stops trusting the one place the product promises safety.
    expect(optionsOf(success).action).toBeUndefined();
  });
});

describe('copy', () => {
  test('every string this module produces comes from i18n', async () => {
    await i18n.changeLanguage('ar');

    toastError(new ApiRequestError('INTERNAL_ERROR', 'boom', 500, 'req-1'), {
      onRetry: () => undefined,
    });

    // A toast is the easiest place in a codebase to leave an English literal.
    expect(optionsOf(error).action?.label).toBe('حاول مرة أخرى');
    expect(optionsOf(error).description).toContain('المرجع');
  });
});
