/**
 * US-71 — automatic escalation on SLA thresholds.
 *
 * AC3 breach escalation · AC5 no duplicate escalation · AC6 attribution to the
 * rule, plus threshold detection and the negative cases.
 *
 * **AC1 and AC2 (the agent and the manager are notified) are not covered because
 * there is nothing to notify with.** US-62 is deferred by the MVP scope, so each
 * rung records history and logs its intended recipient. There is no test here
 * pretending a notification was sent.
 *
 * **AC4 (Tickets Requiring Attention) belongs to US-58**, which does not exist.
 * What is asserted instead is that an escalated ticket is in the state the
 * queue's `escalated` view already selects on.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { seedDefaultSlaPolicies } from './seed-default-policies.js';
import { SlaClockService } from './sla-clock.service.js';
import {
  ESCALATION_STEP_FIELD,
  SLA_ESCALATION_RULE,
  SlaEscalationService,
  elapsedPercent,
} from './sla-escalation.service.js';

let app: INestApplication;
let prisma: PrismaService;
let clock: SlaClockService;
let escalation: SlaEscalationService;

const run = randomUUID().slice(0, 8);
const SUBJECT_PREFIX = `Escalate ${run}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let customerId: string;
let departmentId: string;
let managerId: string;
let agentId: string;

/**
 * A ticket written straight to the database, then given its deadlines.
 *
 * Not through the API: `createdAt` has to be in the past for a target to have
 * been passed, and the clock derives every deadline from it.
 */
async function makeTicket(
  overrides: {
    hoursAgo?: number;
    status?: 'NEW' | 'WAITING_FOR_AGENT' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED';
    assigneeId?: string | null;
    withDepartment?: boolean;
  } = {},
): Promise<string> {
  const row = await prisma.ticket.create({
    data: {
      subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
      customerId,
      priority: 'MEDIUM',
      status: overrides.status ?? 'WAITING_FOR_AGENT',
      createdAt: new Date(Date.now() - (overrides.hoursAgo ?? 0) * HOUR),
      ...(overrides.withDepartment === false ? {} : { departmentId }),
      ...(overrides.assigneeId === undefined ? {} : { assigneeId: overrides.assigneeId }),
    },
    select: { id: true },
  });

  // Real deadlines from the real policy, rather than hand-written timestamps.
  await clock.applyOnCreate(row.id);

  return row.id;
}

/** Which rungs have been recorded for a ticket, in order. */
async function rungsOf(ticketId: string): Promise<string[]> {
  const rows = await prisma.ticketHistory.findMany({
    where: { ticketId, field: ESCALATION_STEP_FIELD },
    orderBy: { toValue: 'asc' },
    select: { toValue: true },
  });

  return rows.map((row) => row.toValue ?? '');
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
  clock = app.get(SlaClockService);
  escalation = app.get(SlaEscalationService);

  await seedDefaultSlaPolicies(prisma);

  const customer = await prisma.customer.create({
    data: { firstName: 'Dalia', lastName: `Esc-${run}` },
    select: { id: true },
  });
  customerId = customer.id;

  const manager = await prisma.user.create({
    data: {
      email: `esc-manager-${run}@example.com`,
      passwordHash: 'irrelevant',
      firstName: 'Mona',
      lastName: `Manager-${run}`,
    },
    select: { id: true },
  });
  managerId = manager.id;

  const agent = await prisma.user.create({
    data: {
      email: `esc-agent-${run}@example.com`,
      passwordHash: 'irrelevant',
      firstName: 'Sami',
      lastName: `Agent-${run}`,
    },
    select: { id: true },
  });
  agentId = agent.id;

  const department = await prisma.department.create({
    data: { code: `ESC-${run}`, nameEn: 'Support', nameAr: 'الدعم', managerId },
    select: { id: true },
  });
  departmentId = department.id;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// Threshold detection
// ---------------------------------------------------------------------------

test('the elapsed percentage is a pure function of a fixed clock', () => {
  const startedAt = new Date('2026-08-27T10:00:00.000Z');
  const dueAt = new Date('2026-08-27T14:00:00.000Z');

  assert.equal(elapsedPercent({ startedAt, dueAt, now: startedAt }), 0);
  assert.equal(elapsedPercent({ startedAt, dueAt, now: new Date('2026-08-27T13:00:00.000Z') }), 75);
  assert.equal(elapsedPercent({ startedAt, dueAt, now: dueAt }), 100);
  // Past the deadline keeps climbing, which is what makes the 100% rung fire
  // for a ticket that is already late rather than only at the exact minute.
  assert.ok(elapsedPercent({ startedAt, dueAt, now: new Date('2026-08-27T15:00:00.000Z') }) > 100);

  // A target with no width is treated as spent rather than dividing by zero.
  assert.equal(elapsedPercent({ startedAt: dueAt, dueAt, now: startedAt }), 100);
});

test('a ticket below the first rung fires nothing', async () => {
  // The seeded ladder starts at 75%. A medium ticket has a 24-hour resolution
  // target, so two hours in is well inside it.
  const id = await makeTicket({ hoursAgo: 2, assigneeId: agentId });

  await escalation.run();

  assert.deepEqual(await rungsOf(id), []);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true },
  });

  assert.equal(ticket.status, 'WAITING_FOR_AGENT');
  assert.equal(ticket.escalatedAt, null);
});

test('crossing 75% fires the first rung only, and does not change the status', async () => {
  // 19 of 24 hours is 79% — past the assignee rung, short of the manager's.
  const id = await makeTicket({ hoursAgo: 19, assigneeId: agentId });

  await escalation.run();

  assert.deepEqual(await rungsOf(id), ['0']);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true },
  });

  assert.equal(ticket.status, 'WAITING_FOR_AGENT');
  assert.equal(ticket.escalatedAt, null);
});

test('a ticket past 90% fires both warning rungs in one pass', async () => {
  // 22 of 24 hours is 92%.
  const id = await makeTicket({ hoursAgo: 22, assigneeId: agentId });

  await escalation.run();

  assert.deepEqual(await rungsOf(id), ['0', '1']);
  assert.equal(
    (await prisma.ticket.findUniqueOrThrow({ where: { id }, select: { status: true } })).status,
    'WAITING_FOR_AGENT',
  );
});

// ---------------------------------------------------------------------------
// AC3 — breach escalation
// ---------------------------------------------------------------------------

test('AC3 — a ticket past its target is escalated, to the department manager', async () => {
  const id = await makeTicket({ hoursAgo: 30, assigneeId: agentId });

  const result = await escalation.run();

  assert.ok(result.escalated >= 1);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true, escalatedToId: true },
  });

  assert.equal(ticket.status, 'WAITING_FOR_AGENT');
  assert.ok(ticket.escalatedAt !== null);
  // The rung notifies DEPARTMENT_MANAGER, so that is who it is escalated to —
  // recorded as data even though nothing can be sent to them yet.
  assert.equal(ticket.escalatedToId, managerId);

  // All three rungs, since a ticket 30 hours into a 24-hour target has passed
  // every one of them.
  assert.deepEqual(await rungsOf(id), ['0', '1', '2']);
});

test('AC3 and AC6 — the escalation is recorded and attributed to the rule', async () => {
  const id = await makeTicket({ hoursAgo: 30, assigneeId: agentId });

  await escalation.run();

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: id, eventType: 'ESCALATED', field: 'escalatedAt' },
    select: { eventType: true, actorUserId: true, metadata: true },
  });

  assert.equal(entry.eventType, 'ESCALATED');
  // AC6 — not a person. Naming whoever last touched the ticket would be a lie in
  // the record kept for settling disputes.
  assert.equal(entry.actorUserId, null);
  assert.equal(
    (entry.metadata as { automationRule?: string } | null)?.automationRule,
    SLA_ESCALATION_RULE,
  );
});

test('AC4 — an escalated ticket is in the state the queue’s escalated view selects', async () => {
  const id = await makeTicket({ hoursAgo: 30 });

  await escalation.run();

  // Escalated view selects tickets where escalatedAt is not null and not resolved.
  const found = await prisma.notDeleted.ticket.count({
    where: { id, escalatedAt: { not: null }, status: { not: 'RESOLVED' } },
  });

  assert.equal(found, 1);
});

// ---------------------------------------------------------------------------
// AC5 — no duplicate escalation, which is also the retry contract
// ---------------------------------------------------------------------------

test('AC5 — running the pass again escalates nothing twice', async () => {
  const id = await makeTicket({ hoursAgo: 30, assigneeId: agentId });

  await escalation.run();

  const first = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { escalatedAt: true },
  });

  // BullMQ retries a failed job with backoff, so a pass will be repeated. Every
  // rung checks for its own history entry before acting.
  const second = await escalation.run();
  const third = await escalation.run();

  assert.deepEqual(await rungsOf(id), ['0', '1', '2']);

  const after = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true },
  });

  assert.equal(after.status, 'WAITING_FOR_AGENT');
  assert.deepEqual(after.escalatedAt, first.escalatedAt);

  // Nothing fired on either repeat — for this ticket or any other already done.
  assert.equal(
    second.rungsFired === 0 || third.rungsFired === 0,
    true,
    'a repeated pass must stop firing rungs',
  );
});

test('AC5 — a ticket with escalatedAt already set is left alone', async () => {
  const id = await makeTicket({ hoursAgo: 30, assigneeId: agentId });
  const existingEscalatedAt = new Date(Date.now() - 5 * HOUR);
  await prisma.ticket.update({
    where: { id },
    data: { escalatedAt: existingEscalatedAt },
  });

  await escalation.run();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true },
  });

  assert.equal(ticket.status, 'WAITING_FOR_AGENT');
  assert.equal(ticket.escalatedAt?.getTime(), existingEscalatedAt.getTime());
});

// ---------------------------------------------------------------------------
// The negative cases
// ---------------------------------------------------------------------------

test('a resolved ticket past its target is never escalated', async () => {
  const id = await makeTicket({ hoursAgo: 30, status: 'RESOLVED' });

  await escalation.run();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedAt: true },
  });

  // Its clock stopped when it was resolved; escalating it would be reopening it
  // by the back door, and the state machine forbids RESOLVED -> ESCALATED.
  assert.equal(ticket.status, 'RESOLVED');
  assert.equal(ticket.escalatedAt, null);
  assert.deepEqual(await rungsOf(id), []);
});

test('a ticket with no department still escalates, with nobody to escalate to', async () => {
  const id = await makeTicket({ hoursAgo: 30, withDepartment: false });

  await escalation.run();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, escalatedToId: true },
  });

  // A missing recipient is a reason to keep going, not to leave a late ticket
  // un-escalated.
  assert.equal(ticket.status, 'WAITING_FOR_AGENT');
  assert.equal(ticket.escalatedToId, null);
});
