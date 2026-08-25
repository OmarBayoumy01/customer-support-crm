import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CommonModule } from '../common.module.js';
import { ApiException } from '../errors/api.exception.js';
import { RequestContextService } from '../request-context/request-context.service.js';
import { REQUEST_ID_HEADER } from '../request-context/request-id.middleware.js';
import { defaultLevelFor, isEnabled, LOG_LEVELS } from './log-level.js';
import { STRUCTURED_LOGGER } from './logger.token.js';
import { redact, redactHeaders, redactText, REDACTED } from './redact.js';
import { StructuredLogger, type LogRecord } from './structured-logger.js';

// ---------------------------------------------------------------------------
// AC3 — redaction
// ---------------------------------------------------------------------------

test('AC3 — obvious secrets are replaced, not written', () => {
  const result = redact({
    email: 'omar@example.com',
    password: 'hunter2',
    passwordHash: '$2b$10$abcdef',
    accessToken: 'ey.jwt.here',
    apiKey: 'sk-live-123',
  }) as Record<string, unknown>;

  assert.equal(result['email'], 'omar@example.com', 'a non-secret must survive');
  assert.equal(result['password'], REDACTED);
  assert.equal(result['passwordHash'], REDACTED);
  assert.equal(result['accessToken'], REDACTED);
  assert.equal(result['apiKey'], REDACTED);
});

test('AC3 — redaction reaches nested objects and arrays', () => {
  const result = redact({
    user: { name: 'Aya', profile: { password: 'x' } },
    logins: [{ token: 'a' }, { token: 'b' }],
  }) as { user: { profile: Record<string, unknown> }; logins: Array<Record<string, unknown>> };

  assert.equal(result.user.profile['password'], REDACTED);
  assert.equal(result.logins[0]?.['token'], REDACTED);
  assert.equal(result.logins[1]?.['token'], REDACTED);
});

test('AC3 — a whole object under a sensitive key is replaced, not walked into', () => {
  // `credentials` matches the key list, so the value never gets serialised at
  // all — which is stronger than redacting the fields inside it, and is the
  // behaviour to keep.
  const result = redact({ credentials: { username: 'a', password: 'b' } }) as Record<
    string,
    unknown
  >;

  assert.equal(result['credentials'], REDACTED);
});

test('AC3 — key matching is case-insensitive and catches variants', () => {
  const result = redact({
    Password: 'a',
    NEW_PASSWORD: 'b',
    refreshToken: 'c',
    'x-api-key': 'd',
  }) as Record<string, unknown>;

  for (const key of Object.keys(result)) {
    assert.equal(result[key], REDACTED, `${key} should have been redacted`);
  }
});

test('AC3 — a cyclic object does not take the process down', () => {
  const cyclic: Record<string, unknown> = { name: 'loop' };
  cyclic['self'] = cyclic;

  const result = redact(cyclic) as Record<string, unknown>;

  assert.equal(result['name'], 'loop');
  assert.equal(result['self'], '[CIRCULAR]');
});

test('AC3 — an Error keeps its message and stack instead of serialising to {}', () => {
  const result = redact(new Error('boom')) as { name: string; message: string; stack?: string };

  assert.equal(result.name, 'Error');
  assert.equal(result.message, 'boom');
  assert.ok(result.stack !== undefined);
});

test('AC3 — the authorization header is redacted', () => {
  const result = redactHeaders({
    authorization: 'Bearer ey.jwt.here',
    cookie: 'session=abc',
    'user-agent': 'curl/8',
  });

  assert.equal(result['authorization'], REDACTED);
  assert.equal(result['cookie'], REDACTED);
  assert.equal(result['user-agent'], 'curl/8', 'a harmless header must survive');
});

test('AC3 — secrets interpolated into a message are scrubbed too', () => {
  assert.match(redactText('called with Bearer ey.JwT.token'), /Bearer \[REDACTED\]/);
  assert.match(
    redactText('postgresql://crm:supersecret@localhost:5432/crm'),
    /postgresql:\/\/crm:\[REDACTED\]@/,
  );
  assert.match(redactText('password=hunter2 and more'), /password=\[REDACTED\]/);
  assert.match(redactText('{"token": "abc123"}'), /\[REDACTED\]/);
});

// ---------------------------------------------------------------------------
// AC4 — level control
// ---------------------------------------------------------------------------

test('AC4 — a level enables itself and everything less verbose', () => {
  assert.equal(isEnabled('warn', 'error'), true);
  assert.equal(isEnabled('warn', 'warn'), true);
  assert.equal(isEnabled('warn', 'info'), false);
  assert.equal(isEnabled('verbose', 'debug'), true);
});

test('AC4 — the default depends on the environment, not on a code change', () => {
  assert.equal(defaultLevelFor('production'), 'info');
  assert.equal(defaultLevelFor('development'), 'debug');
  assert.equal(defaultLevelFor('test'), 'debug');
});

test('AC4 — the configured level actually suppresses output', () => {
  const lines: string[] = [];
  const context = new RequestContextService();
  const logger = new StructuredLogger(
    context,
    'warn',
    (line) => lines.push(line),
    (line) => lines.push(line),
  );

  logger.error('an error');
  logger.warn('a warning');
  logger.log('an info line');
  logger.debug('a debug line');

  const messages = lines.map((line) => (JSON.parse(line) as LogRecord).message);

  assert.deepEqual(messages, ['an error', 'a warning']);
});

test('AC4 — every declared level is accepted by the schema list', () => {
  assert.deepEqual([...LOG_LEVELS], ['error', 'warn', 'info', 'debug', 'verbose']);
});

// ---------------------------------------------------------------------------
// AC1 — structured output
// ---------------------------------------------------------------------------

function capture(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' = 'verbose'): {
  logger: StructuredLogger;
  context: RequestContextService;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const context = new RequestContextService();
  const logger = new StructuredLogger(
    context,
    level,
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  );

  return { logger, context, stdout, stderr };
}

test('AC1 — every line is JSON with timestamp, level, message, and request id', () => {
  const { logger, context, stdout } = capture();

  context.run({ requestId: 'req-1', method: 'GET', path: '/x' }, () => {
    logger.log('hello', 'SomeService');
  });

  const record = JSON.parse(stdout[0] ?? '') as LogRecord;

  assert.equal(record.level, 'info');
  assert.equal(record.message, 'hello');
  assert.equal(record.requestId, 'req-1');
  assert.equal(record.context, 'SomeService');
  assert.ok(!Number.isNaN(Date.parse(record.timestamp)), 'timestamp should be ISO 8601');
});

test('AC1 — the user id appears once it is known, and not before', () => {
  const { logger, context, stdout } = capture();

  context.run({ requestId: 'req-2', method: 'GET', path: '/x' }, () => {
    logger.log('before auth');
    context.setUserId('user-123');
    logger.log('after auth');
  });

  const [first, second] = stdout.map((line) => JSON.parse(line) as LogRecord);

  assert.equal(first?.userId, undefined, 'no user id before the request is authenticated');
  assert.equal(second?.userId, 'user-123');
});

test('AC1 — a line written outside a request is still valid JSON', () => {
  const { logger, stdout } = capture();

  logger.log('during startup');

  const record = JSON.parse(stdout[0] ?? '') as LogRecord;
  assert.equal(record.requestId, '-');
});

test('AC1 — structured fields are redacted on the way out', () => {
  const { logger, stdout } = capture();

  logger.emit('info', 'user created', { email: 'a@b.com', password: 'hunter2' });

  const record = JSON.parse(stdout[0] ?? '') as LogRecord;

  assert.equal(record['email'], 'a@b.com');
  assert.equal(record['password'], REDACTED);
});

test('errors and warnings go to stderr, everything else to stdout', () => {
  const { logger, stdout, stderr } = capture();

  logger.error('bad');
  logger.warn('iffy');
  logger.log('fine');

  assert.equal(stderr.length, 2);
  assert.equal(stdout.length, 1);
});

// ---------------------------------------------------------------------------
// AC2 — request lifecycle, against a running app
// ---------------------------------------------------------------------------

@Controller('logged')
class LoggedController {
  @Get('ok')
  ok(): { fine: true } {
    return { fine: true };
  }

  @Get('bad')
  bad(): never {
    throw ApiException.notFound('Nothing');
  }
}

@Module({ imports: [CommonModule], controllers: [LoggedController] })
class LoggingTestModule {}

let app: INestApplication;
let baseUrl: string;
const captured: string[] = [];

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [LoggingTestModule] })
    .overrideProvider(STRUCTURED_LOGGER)
    .useFactory({
      inject: [RequestContextService],
      factory: (context: RequestContextService) =>
        new StructuredLogger(
          context,
          'verbose',
          (line) => captured.push(line),
          (line) => captured.push(line),
        ),
    })
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await app.close();
});

/** The access-log line is written on `finish`, which can land just after the fetch resolves. */
async function accessLogFor(path: string): Promise<LogRecord> {
  const before = captured.length;
  await fetch(`${baseUrl}${path}`);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = captured
      .slice(before)
      .map((line) => JSON.parse(line) as LogRecord)
      .find((record) => record.message === 'request completed');

    if (found !== undefined) {
      return found;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`no access log line was written for ${path}`);
}

test('AC2 — a completed request logs method, path, status, and duration', async () => {
  const record = await accessLogFor('/logged/ok');

  assert.equal(record.level, 'info');
  assert.equal(record['method'], 'GET');
  assert.equal(record['path'], '/logged/ok');
  assert.equal(record['statusCode'], 200);
  assert.equal(typeof record['durationMs'], 'number');
  assert.ok((record['durationMs'] as number) >= 0);
});

test('AC2 — the access log carries the same request id as the response', async () => {
  const before = captured.length;
  const response = await fetch(`${baseUrl}/logged/ok`, {
    headers: { [REQUEST_ID_HEADER]: 'traced-request' },
  });

  assert.equal(response.headers.get(REQUEST_ID_HEADER), 'traced-request');

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = captured
      .slice(before)
      .map((line) => JSON.parse(line) as LogRecord)
      .find((record) => record.message === 'request completed');

    if (found !== undefined) {
      assert.equal(found.requestId, 'traced-request');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('no access log line was written');
});

test('AC2 — a failed request is logged too, at a findable level', async () => {
  const record = await accessLogFor('/logged/bad');

  assert.equal(record['statusCode'], 404);
  assert.equal(record.level, 'warn');
});

test('AC2 — an unmatched route is logged, which an interceptor would have missed', async () => {
  const record = await accessLogFor('/no-such-route');

  assert.equal(record['statusCode'], 404);
  assert.equal(record['path'], '/no-such-route');
});

test('AC3 — a token in a query string never reaches the access log', async () => {
  const record = await accessLogFor('/logged/ok?token=super-secret-value');

  assert.doesNotMatch(
    String(record['path']),
    /super-secret-value/,
    'the access log must not record a leaked token',
  );
  assert.match(String(record['path']), /REDACTED/);
});
