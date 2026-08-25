import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Test } from '@nestjs/testing';

import { TypedConfigModule } from './config.module.js';
import { TypedConfigService } from './typed-config.service.js';

test('TypedConfigService resolves through the DI container and returns typed values (AC3)', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [TypedConfigModule] }).compile();
  const config = moduleRef.get(TypedConfigService);

  const port: number = config.get('PORT');
  const host: string = config.get('HOST');
  const nodeEnv = config.get('NODE_ENV');

  assert.equal(typeof port, 'number');
  assert.equal(typeof host, 'string');
  assert.ok(['development', 'test', 'staging', 'production'].includes(nodeEnv));

  await moduleRef.close();
});
