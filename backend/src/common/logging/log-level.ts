/**
 * Levels in increasing verbosity. A configured level enables itself and
 * everything above it in this list.
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

/** True when a message at `level` should be written given the configured level. */
export function isEnabled(configured: LogLevel, level: LogLevel): boolean {
  return RANK[level] <= RANK[configured];
}

/**
 * The default when `LOG_LEVEL` is unset (AC4).
 *
 * Production is quieter because debug lines there are volume and cost without
 * being read; everywhere else defaults to `debug`, because a developer who has
 * to set an environment variable to see what happened will not set it.
 */
export function defaultLevelFor(nodeEnv: string): LogLevel {
  return nodeEnv === 'production' ? 'info' : 'debug';
}
