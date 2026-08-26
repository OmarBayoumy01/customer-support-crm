import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from './prisma.service.js';

let app: INestApplication;
let prisma: PrismaService;

const run = randomUUID().slice(0, 8);

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  prisma = app.get(PrismaService);
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC4 — timestamps and soft delete
// ---------------------------------------------------------------------------

test('AC4 — createdAt and updatedAt are set automatically on create', async () => {
  const before = new Date();

  const branch = await prisma.branch.create({
    data: { code: `TS-${run}`, nameEn: 'Timestamps', nameAr: 'الطوابع' },
  });

  assert.ok(branch.createdAt instanceof Date);
  assert.ok(branch.updatedAt instanceof Date);
  assert.ok(branch.createdAt.getTime() >= before.getTime() - 1_000);
  assert.equal(branch.deletedAt, null, 'a new row is not deleted');
});

test('AC4 — updatedAt moves on update while createdAt stays put', async () => {
  const branch = await prisma.branch.create({
    data: { code: `TS2-${run}`, nameEn: 'Before', nameAr: 'قبل' },
  });

  // Postgres timestamps have microsecond resolution, but two writes inside the
  // same millisecond would make this assertion meaningless.
  await new Promise((resolve) => setTimeout(resolve, 5));

  const updated = await prisma.branch.update({
    where: { id: branch.id },
    data: { nameEn: 'After' },
  });

  assert.equal(updated.createdAt.getTime(), branch.createdAt.getTime(), 'createdAt is immutable');
  assert.ok(
    updated.updatedAt.getTime() > branch.updatedAt.getTime(),
    'updatedAt should advance on every write',
  );
});

test('AC4 — a soft-deleted row disappears from notDeleted but still exists', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Soft', lastName: 'Deleted', email: `soft-${run}@example.com` },
  });

  assert.equal(await prisma.notDeleted.customer.count({ where: { id: customer.id } }), 1);

  await prisma.customer.update({
    where: { id: customer.id },
    data: { deletedAt: new Date() },
  });

  assert.equal(
    await prisma.notDeleted.customer.count({ where: { id: customer.id } }),
    0,
    'the filtered client should not see a soft-deleted row',
  );
  assert.equal(
    await prisma.customer.count({ where: { id: customer.id } }),
    1,
    'the row is still there — soft delete is not a delete',
  );
});

test('AC4 — the filter applies to findMany, findFirst, and aggregates alike', async () => {
  const marker = `filter-${run}`;

  const live = await prisma.customer.create({
    data: { firstName: 'Live', lastName: marker, email: `live-${run}@example.com` },
  });
  await prisma.customer.create({
    data: {
      firstName: 'Gone',
      lastName: marker,
      email: `gone-${run}@example.com`,
      deletedAt: new Date(),
    },
  });

  const found = await prisma.notDeleted.customer.findMany({ where: { lastName: marker } });
  assert.deepEqual(
    found.map((row) => row.id),
    [live.id],
  );

  const first = await prisma.notDeleted.customer.findFirst({ where: { lastName: marker } });
  assert.equal(first?.id, live.id);

  assert.equal(await prisma.notDeleted.customer.count({ where: { lastName: marker } }), 1);
  assert.equal(await prisma.customer.count({ where: { lastName: marker } }), 2);
});

test('AC4 — the caller-supplied where survives the filter', async () => {
  const marker = `merge-${run}`;

  await prisma.customer.create({
    data: { firstName: 'Keep', lastName: marker, email: `keep-${run}@example.com` },
  });
  await prisma.customer.create({
    data: { firstName: 'Other', lastName: marker, email: `other-${run}@example.com` },
  });

  const found = await prisma.notDeleted.customer.findMany({
    where: { lastName: marker, firstName: 'Keep' },
  });

  assert.equal(found.length, 1, 'the extension must add to the where clause, not replace it');
  assert.equal(found[0]?.firstName, 'Keep');
});

test('AC4 — append-only tables are left alone by the filter', async () => {
  // AuditLog has no deletedAt column. If the extension tried to filter it, this
  // query would fail with an unknown-argument error rather than returning.
  const count = await prisma.notDeleted.auditLog.count();
  assert.equal(typeof count, 'number');

  const historyCount = await prisma.notDeleted.ticketHistory.count();
  assert.equal(typeof historyCount, 'number');
});

test('AC4 — the unfiltered client remains reachable for restore and audit paths', async () => {
  const customer = await prisma.customer.create({
    data: {
      firstName: 'Restore',
      lastName: 'Me',
      email: `restore-${run}@example.com`,
      deletedAt: new Date(),
    },
  });

  assert.equal(await prisma.notDeleted.customer.count({ where: { id: customer.id } }), 0);

  await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: null } });

  assert.equal(
    await prisma.notDeleted.customer.count({ where: { id: customer.id } }),
    1,
    'clearing deletedAt should bring the row back',
  );
});
