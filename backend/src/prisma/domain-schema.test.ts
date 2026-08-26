import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from './prisma.service.js';

let app: INestApplication;
let prisma: PrismaService;

/**
 * The test database persists between runs, so every unique column gets a
 * per-run suffix. Without it a second `npm run test` fails on constraints
 * rather than on behaviour.
 */
const run = `${String(process.pid)}-${String(Math.floor(performance.now()))}`;

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
// AC1 — every named entity exists
// ---------------------------------------------------------------------------

test('AC1 — the schema contains all sixteen core entities', async () => {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;

  const tables = new Set(rows.map((row) => row.table_name));

  for (const entity of [
    'User',
    'Role',
    'Permission',
    'Department',
    'Branch',
    'Customer',
    'Ticket',
    'Message',
    'Attachment',
    'Category',
    'TicketHistory',
    'SlaPolicy',
    'Task',
    'Notification',
    'KnowledgeArticle',
    'AuditLog',
  ]) {
    assert.ok(tables.has(entity), `the story requires a ${entity} table`);
  }
});

test('US-14 — the Session table exists with its unique hash and lookup indexes', async () => {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Session'`;

  assert.equal(rows.length, 1, 'US-14 added Session so US-16 has something to revoke');

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Session'`;

  const names = indexes.map((row) => row.indexname);

  // Unique, so the "impossible" collision of two 256-bit tokens is loud rather
  // than silently authenticating the wrong person.
  assert.ok(names.includes('Session_refreshTokenHash_key'));
  // Listing a user's live sessions — what US-16's UI reads.
  assert.ok(names.includes('Session_userId_revokedAt_idx'));
  // Cleaning up expired rows.
  assert.ok(names.includes('Session_expiresAt_idx'));
});

test('US-14 — deleting a user takes their sessions with them', async () => {
  const user = await prisma.user.create({
    data: {
      email: `session-cascade-${run}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Session',
      lastName: 'Cascade',
    },
    select: { id: true },
  });

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `hash-${run}`,
      audience: 'crm-staff',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await prisma.user.delete({ where: { id: user.id } });

  // A hard-deleted user leaving live sessions behind would be a way back in.
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
});

test('AC1 — the temporary MigrationProbe from US-5 is gone', async () => {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'MigrationProbe'`;

  assert.equal(rows.length, 0, 'US-6 was supposed to drop the probe model');
});

// ---------------------------------------------------------------------------
// AC2 — a ticket resolves its whole graph
// ---------------------------------------------------------------------------

test('AC2 — a ticket resolves customer, agent, category, department, branch, messages, attachments, history, and SLA', async () => {
  const branch = await prisma.branch.create({
    data: { code: `BR-${run}`, nameEn: 'Riyadh', nameAr: 'الرياض' },
  });

  const department = await prisma.department.create({
    data: { code: `DP-${run}`, nameEn: 'Billing', nameAr: 'الفوترة', branchId: branch.id },
  });

  const agent = await prisma.user.create({
    data: {
      email: `agent-${run}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Aya',
      lastName: 'Nasser',
      departmentId: department.id,
      branchId: branch.id,
    },
  });

  const category = await prisma.category.create({
    data: {
      slug: `refunds-${run}`,
      nameEn: 'Refunds',
      nameAr: 'المبالغ المستردة',
      departmentId: department.id,
      defaultPriority: 'HIGH',
    },
  });

  const customer = await prisma.customer.create({
    data: { firstName: 'Omar', lastName: 'Bayoumy', email: `cust-${run}@example.com` },
  });

  const sla = await prisma.slaPolicy.create({
    data: {
      nameEn: 'High priority',
      nameAr: 'أولوية عالية',
      priority: 'HIGH',
      departmentId: department.id,
      firstResponseMinutes: 30,
      resolutionMinutes: 480,
    },
  });

  const ticket = await prisma.ticket.create({
    data: {
      subject: 'Refund not received',
      customerId: customer.id,
      assigneeId: agent.id,
      categoryId: category.id,
      departmentId: department.id,
      branchId: branch.id,
      slaPolicyId: sla.id,
      priority: 'HIGH',
      status: 'OPEN',
      channel: 'EMAIL',
      firstResponseDueAt: new Date(Date.now() + 30 * 60_000),
      resolutionDueAt: new Date(Date.now() + 480 * 60_000),
    },
  });

  const message = await prisma.message.create({
    data: {
      ticketId: ticket.id,
      senderType: 'CUSTOMER',
      authorCustomerId: customer.id,
      body: 'I still have not received my refund.',
    },
  });

  await prisma.attachment.create({
    data: {
      messageId: message.id,
      ticketId: ticket.id,
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: `receipts/${run}.pdf`,
      uploadedById: agent.id,
    },
  });

  await prisma.ticketHistory.create({
    data: { ticketId: ticket.id, actorUserId: agent.id, eventType: 'CREATED' },
  });

  const loaded = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: {
      customer: true,
      assignee: true,
      category: true,
      department: true,
      branch: true,
      slaPolicy: true,
      messages: { include: { attachments: true } },
      history: true,
    },
  });

  assert.equal(loaded.customer.id, customer.id);
  assert.equal(loaded.assignee?.id, agent.id);
  assert.equal(loaded.category?.nameAr, 'المبالغ المستردة');
  assert.equal(loaded.department?.id, department.id);
  assert.equal(loaded.branch?.id, branch.id);
  assert.equal(loaded.slaPolicy?.firstResponseMinutes, 30);
  assert.equal(loaded.messages.length, 1);
  assert.equal(loaded.messages[0]?.attachments.length, 1);
  assert.equal(loaded.history.length, 1);
  assert.ok(loaded.number > 0, 'a ticket gets a human-facing sequential number');
});

test('AC2 — a customer with tickets cannot be deleted out from under them', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Restrict', lastName: 'Check', email: `restrict-${run}@example.com` },
  });
  await prisma.ticket.create({
    data: { subject: 'Keeps the customer alive', customerId: customer.id },
  });

  await assert.rejects(
    () => prisma.customer.delete({ where: { id: customer.id } }),
    /Foreign key constraint|violates foreign key/i,
  );
});

test('AC2 — deleting a ticket cascades to its messages and attachments', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Cascade', lastName: 'Check', email: `cascade-${run}@example.com` },
  });
  const ticket = await prisma.ticket.create({
    data: { subject: 'Will be deleted', customerId: customer.id },
  });
  const message = await prisma.message.create({
    data: { ticketId: ticket.id, senderType: 'SYSTEM', body: 'hello' },
  });
  await prisma.attachment.create({
    data: {
      messageId: message.id,
      ticketId: ticket.id,
      fileName: 'a.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      storageKey: `cascade/${run}.txt`,
    },
  });

  await prisma.ticket.delete({ where: { id: ticket.id } });

  assert.equal(await prisma.message.count({ where: { id: message.id } }), 0);
  assert.equal(await prisma.attachment.count({ where: { ticketId: ticket.id } }), 0);
});

// ---------------------------------------------------------------------------
// AC3 — enums are enforced by the database, not just by TypeScript
// ---------------------------------------------------------------------------

test('AC3 — the database rejects an invalid ticket status', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Enum', lastName: 'Status', email: `enum-status-${run}@example.com` },
  });

  // Raw SQL on purpose: going through the client would be caught by the
  // generated types, which proves nothing about the database. This writes the
  // bad value directly and expects PostgreSQL itself to refuse it.
  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "Ticket" (id, subject, status, "customerId", "updatedAt")
         VALUES (gen_random_uuid()::text, 'bad status', 'DEFINITELY_NOT_A_STATUS', $1, now())`,
        customer.id,
      ),
    /invalid input value for enum/i,
  );
});

test('AC3 — the database rejects an invalid ticket priority', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Enum', lastName: 'Priority', email: `enum-prio-${run}@example.com` },
  });

  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "Ticket" (id, subject, priority, "customerId", "updatedAt")
         VALUES (gen_random_uuid()::text, 'bad priority', 'SUPER_URGENT', $1, now())`,
        customer.id,
      ),
    /invalid input value for enum/i,
  );
});

test('AC3 — every status and priority from the story is accepted', async () => {
  const rows = await prisma.$queryRaw<Array<{ typname: string; enumlabel: string }>>`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('TicketStatus', 'TicketPriority', 'Channel')`;

  const labels = (type: string): string[] =>
    rows.filter((row) => row.typname === type).map((row) => row.enumlabel);

  assert.deepEqual(labels('TicketStatus').sort(), [
    'CLOSED',
    'ESCALATED',
    'NEW',
    'OPEN',
    'PENDING_CUSTOMER',
    'PENDING_INTERNAL',
    'RESOLVED',
  ]);
  assert.deepEqual(labels('TicketPriority').sort(), ['HIGH', 'LOW', 'MEDIUM', 'URGENT']);
  assert.deepEqual(labels('Channel').sort(), ['CHAT', 'EMAIL', 'SMS', 'WEB', 'WHATSAPP']);
});

// ---------------------------------------------------------------------------
// AC5 — the hot-path queries use indexes, at realistic volume
// ---------------------------------------------------------------------------

const PERF_TAG = `perf-${run}`;

async function explain(sql: string, params: unknown[] = []): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    `EXPLAIN ${sql}`,
    ...params,
  );

  // EXPLAIN's column is named "QUERY PLAN"; take whatever the single column is.
  return rows.map((row) => Object.values(row)[0] ?? '').join('\n');
}

test('AC5 — the agent queue and SLA sweep use indexes rather than sequential scans', async () => {
  const customer = await prisma.customer.create({
    data: { firstName: 'Volume', lastName: 'Fixture', email: `perf-${run}@example.com` },
  });

  const agents = await Promise.all(
    Array.from({ length: 20 }, (_unused, index) =>
      prisma.user.create({
        data: {
          email: `perf-agent-${String(index)}-${run}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'Perf',
          lastName: `Agent${String(index)}`,
        },
      }),
    ),
  );

  const agentIds = agents.map((agent) => agent.id);

  // One statement rather than 10,000 round trips. Spread across agents,
  // statuses, and due dates so the planner sees realistic selectivity.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Ticket"
       (id, subject, status, priority, channel, "customerId", "assigneeId",
        "resolutionDueAt", tags, "createdAt", "updatedAt")
     SELECT
       gen_random_uuid()::text,
       'Perf ticket ' || i,
       (ARRAY['NEW','OPEN','PENDING_CUSTOMER','RESOLVED','CLOSED']::"TicketStatus"[])[1 + (i % 5)],
       (ARRAY['LOW','MEDIUM','HIGH','URGENT']::"TicketPriority"[])[1 + (i % 4)],
       'WEB'::"Channel",
       $1,
       ($2::text[])[1 + (i % 20)],
       now() + ((i % 500) || ' minutes')::interval,
       ARRAY[$3]::text[],
       now() - ((i % 1000) || ' minutes')::interval,
       now() - ((i % 1000) || ' minutes')::interval
     FROM generate_series(1, 10000) AS i`,
    customer.id,
    agentIds,
    PERF_TAG,
  );

  // Without fresh statistics the planner is guessing, and its guess on a
  // just-populated table is not the one production would make.
  await prisma.$executeRawUnsafe('ANALYZE "Ticket"');

  const agentQueue = await explain(
    `SELECT id, subject FROM "Ticket"
     WHERE "assigneeId" = $1 AND status = 'OPEN'
     ORDER BY "updatedAt" DESC LIMIT 25`,
    [agentIds[0]],
  );

  assert.match(agentQueue, /Index/i, `agent queue plan should use an index:\n${agentQueue}`);
  assert.doesNotMatch(
    agentQueue,
    /Seq Scan on "Ticket"/i,
    `agent queue fell back to a sequential scan:\n${agentQueue}`,
  );

  const slaSweep = await explain(
    `SELECT id FROM "Ticket"
     WHERE status = 'OPEN' AND "resolutionDueAt" < now()
     ORDER BY "resolutionDueAt" LIMIT 100`,
  );

  assert.doesNotMatch(
    slaSweep,
    /Seq Scan on "Ticket"/i,
    `SLA sweep fell back to a sequential scan:\n${slaSweep}`,
  );

  // Clean up the volume fixture so a later run starts from the same place.
  await prisma.$executeRawUnsafe(`DELETE FROM "Ticket" WHERE tags @> ARRAY[$1]::text[]`, PERF_TAG);
});
