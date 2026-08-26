/**
 * US-14, AC4 — passwords are stored as an argon2 hash, never reversibly.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PasswordService } from './password.service.js';

let app: INestApplication;
let passwords: PasswordService;

const PLAIN = 'a-correct-horse-battery-staple';

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  passwords = app.get(PasswordService);
});

after(async () => {
  await app.close();
});

test('AC4 — a stored password is an argon2id hash', async () => {
  const hash = await passwords.hash(PLAIN);

  assert.ok(hash.startsWith('$argon2id$'), `expected an argon2id hash, got: ${hash.slice(0, 20)}`);
});

test('AC4 — the plaintext does not appear anywhere in the hash', async () => {
  const hash = await passwords.hash(PLAIN);

  assert.ok(!hash.includes(PLAIN));
  // Nor any recognisable fragment of it — a hash that leaked a substring would
  // still pass the check above.
  assert.ok(!hash.includes('battery'));
});

test('AC4 — hashing the same password twice gives different hashes', async () => {
  const [first, second] = await Promise.all([passwords.hash(PLAIN), passwords.hash(PLAIN)]);

  // Different salts. Without this, identical passwords are visibly identical in
  // the database and one cracked hash unlocks every account sharing it.
  assert.notEqual(first, second);
});

test('AC4 — verify accepts the right password and rejects the wrong one', async () => {
  const hash = await passwords.hash(PLAIN);

  assert.equal(await passwords.verify(hash, PLAIN), true);
  assert.equal(await passwords.verify(hash, 'not the password'), false);
  // Case matters, and so does a single character.
  assert.equal(await passwords.verify(hash, PLAIN.toUpperCase()), false);
  assert.equal(await passwords.verify(hash, `${PLAIN} `), false);
});

test('AC4 — a corrupted hash refuses the login rather than throwing', async () => {
  // A malformed row should not take the request down with it. The login is
  // refused, which is the safe direction.
  assert.equal(await passwords.verify('not-a-hash-at-all', PLAIN), false);
  assert.equal(await passwords.verify('', PLAIN), false);
});

test('AC2 — verifyDummy completes without throwing, so the unknown-email path can call it', async () => {
  // It exists to burn time, and it must never be the thing that fails: an
  // exception here would make an unknown email answer 500 while a known one
  // answers 401, which is the exact leak it was added to prevent.
  await passwords.verifyDummy();
});
