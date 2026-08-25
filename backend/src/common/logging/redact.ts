/**
 * Keys whose values must never be written to a log, matched case-insensitively
 * and as substrings — so `password`, `passwordHash`, `newPassword`, and
 * `password_confirmation` are all caught by one entry.
 *
 * Separators are stripped before matching, so one entry covers `apiKey`,
 * `api_key`, and the hyphenated `x-api-key` that headers actually arrive as.
 *
 * Substring matching is deliberately over-eager. A field wrongly redacted costs
 * someone a debugging session; a credential written to a log file costs an
 * incident, and the log may already have been shipped somewhere by then.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'auth',
  'cookie',
  'session',
  'apikey',
  'credential',
  'privatekey',
  'otp',
  'pin',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
];

export const REDACTED = '[REDACTED]';

/** How deep to walk before giving up, so a cyclic or vast object cannot hang a log call. */
const MAX_DEPTH = 8;

/**
 * Separators are stripped before matching, so `x-api-key`, `api_key`, and
 * `apiKey` all normalise to `xapikey` / `apikey` and are caught by one entry.
 * Header names in particular arrive hyphenated, and matching the raw string
 * silently missed `x-api-key`.
 */
function isSensitive(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.some((sensitive) => normalised.includes(sensitive));
}

/**
 * Returns a copy of `value` with sensitive fields replaced (AC3).
 *
 * Walks objects and arrays. Cycles are broken by a seen-set rather than by
 * throwing: a log call must never be the thing that takes the process down.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  // An Error's own enumerable properties are usually empty; keep the parts that
  // matter rather than serialising to `{}`.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitive(key) ? REDACTED : redact(nested, depth + 1, seen);
  }

  return result;
}

/**
 * Redacts a header map. Separate from `redact` only because header names arrive
 * in mixed case and may hold arrays.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    result[key] = isSensitive(key) ? REDACTED : value;
  }

  return result;
}

/**
 * Scrubs a free-text message.
 *
 * Structured fields are handled by `redact`, but plenty of secrets reach a log
 * inside an interpolated string — a connection string in a Prisma error, a
 * bearer token in an exception message. This catches the common shapes.
 */
export function redactText(message: string): string {
  return message
    .replace(/(bearer\s+)[\w.\-+/=]+/gi, `$1${REDACTED}`)
    .replace(/(basic\s+)[\w+/=]+/gi, `$1${REDACTED}`)
    .replace(/([a-z+]+:\/\/[^:\s/]+:)[^@\s]+(@)/gi, `$1${REDACTED}$2`)
    .replace(
      /((?:password|token|secret|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi,
      `$1${REDACTED}`,
    );
}
