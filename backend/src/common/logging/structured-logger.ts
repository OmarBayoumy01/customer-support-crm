import type { LoggerService } from '@nestjs/common';

import { RequestContextService } from '../request-context/request-context.service.js';
import { isEnabled, type LogLevel } from './log-level.js';
import { redact, redactText } from './redact.js';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId: string;
  context?: string;
  userId?: string;
  [key: string]: unknown;
}

/** Where a line goes. Swapped in tests; stdout/stderr in production. */
export type LogSink = (line: string) => void;

/**
 * One JSON object per line, on stdout (AC1).
 *
 * Written rather than pulled in. The story's notes suggest `nestjs-pino`, which
 * would mean `pino`, `pino-http`, and `nestjs-pino` — three dependencies outside
 * the approved stack for something that is, at this size, a `JSON.stringify` and
 * a level check. Everything Pino is genuinely better at (async writes, transports,
 * serializer performance) starts to matter at a volume this service is nowhere
 * near, and swapping to it later touches only this file plus the middleware.
 *
 * Errors and warnings go to stderr, everything else to stdout, so a container
 * runtime that separates the two keeps doing the right thing.
 */
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly context: RequestContextService,
    private readonly level: LogLevel,
    private readonly stdout: LogSink = (line) => process.stdout.write(`${line}\n`),
    private readonly stderr: LogSink = (line) => process.stderr.write(`${line}\n`),
  ) {}

  private write(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (!isEnabled(this.level, level)) {
      return;
    }

    // Nest's own calls pass the context (usually a class name) as the last
    // string argument. Anything else is extra detail worth keeping.
    const last = rest.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    const extras = context === undefined ? rest : rest.slice(0, -1);

    const requestContext = this.context.get();

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? redactText(message) : String(redact(message)),
      requestId: requestContext?.requestId ?? '-',
      ...(context === undefined ? {} : { context }),
      ...(requestContext?.userId === undefined ? {} : { userId: requestContext.userId }),
      ...(extras.length === 0 ? {} : { details: extras.map((extra) => redact(extra)) }),
    };

    const line = JSON.stringify(record);

    if (level === 'error' || level === 'warn') {
      this.stderr(line);
    } else {
      this.stdout(line);
    }
  }

  /** Structured logging for application code: fields, not an interpolated string. */
  emit(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (!isEnabled(this.level, level)) {
      return;
    }

    const requestContext = this.context.get();

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message: redactText(message),
      requestId: requestContext?.requestId ?? '-',
      ...(requestContext?.userId === undefined ? {} : { userId: requestContext.userId }),
      ...(redact(fields) as Record<string, unknown>),
    };

    const line = JSON.stringify(record);

    if (level === 'error' || level === 'warn') {
      this.stderr(line);
    } else {
      this.stdout(line);
    }
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('verbose', message, rest);
  }
}
