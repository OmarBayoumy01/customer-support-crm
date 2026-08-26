/**
 * US-68 — the SLA clock.
 *
 * AC1 clock start · AC3 pause and resume · AC4 response satisfied ·
 * AC5 the scheduled check · AC6 recalculation.
 *
 * **AC2 (business hours) is not covered because it is not built.** The MVP scope
 * defers US-75, which owns the calendar, and accepts a 24/7 clock. There is no
 * test here pretending otherwise.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { seedDefaultSlaPolicies } from './seed-default-policies.js';
import { SlaClockService, SLA_BREACH_RULE } from './sla-clock.service.js';
import { SlaPolicyService } from './sla-policy.service.js';

let app: INestApplication;
let prisma: PrismaService;
let clock: SlaClockService;
let policies: SlaPolicyService;

const run = randomUUID().slice(0, 8);

let customerId: string;
let vipCustomerId: string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A ticket written straight to the database.
 *
 * Deliberately not through the API: these tests are about the clock, and
 * `createdAt` has to be in the past for a deadline to have already passed.
 */
async function makeTicket(
  overrides: {
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    status?: 'NEW' | 'OPEN' | 'PENDING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
    hoursAgo?: number;
    customerId?: string;
  } = {},
): Promise<string> {
  const row = await prisma.ticket.create({
    data: {
      subject: `Clock ${run} ${randomUUID().slice(0, 6)}`,
      customerId: overrides.customerId ?? customerId,
      priority: overrides.priority ?? 'MEDIUM',
      status: overrides.status ?? 'OPEN',
      createdAt: new Date(Date.now() - (overrides.hoursAgo ?? 0) * HOUR),
    },
    select: { id: true },
  });

  return row.id;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
  clock = app.get(SlaClockService);
  policies = app.get(SlaPolicyService);

  // The platform policies are what this story computes against. Seeding them is
  // idempotent, so it does not matter whether another suite got there first.
  await seedDefaultSlaPolicies(prisma);

  const customer = await prisma.customer.create({
    data: { firstName: 'Yara', lastName: `Clock-${run}` },
    select: { id: true },
  });
  customerId = customer.id;

  const vip = await prisma.customer.create({
    data: { firstName: 'Faris', lastName: `Vip-${run}`, isVip: true },
    select: { id: true },
  });
  vipCustomerId = vip.id;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: `Clock ${run}` } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — clock start
// ---------------------------------------------------------------------------

test('AC1 — deadlines are computed from the ticket’s own creation time and stored', async () => {
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 1 });

  await clock.applyOnCreate(id);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: {
      createdAt: true,
      slaPolicyId: true,
      firstResponseDueAt: true,
      resolutionDueAt: true,
    },
  });

  assert.ok(ticket.slaPolicyId !== null, 'no policy was applied');

  const policy = await policies.findById(ticket.slaPolicyId);

  assert.ok(policy !== null);
  assert.equal(
    ticket.firstResponseDueAt?.getTime(),
    ticket.createdAt.getTime() + policy.firstResponseMinutes * MINUTE,
  );
  assert.equal(
    ticket.resolutionDueAt?.getTime(),
    ticket.createdAt.getTime() + policy.resolutionMinutes * MINUTE,
  );
});

test('AC1 — the VIP policy applies to a VIP customer’s ticket', async () => {
  const id = await makeTicket({ priority: 'LOW', customerId: vipCustomerId });

  await clock.applyOnCreate(id);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { slaPolicyId: true, resolutionDueAt: true, createdAt: true },
  });

  const policy = await policies.findById(ticket.slaPolicyId!);

  // A VIP's low-priority ticket takes the VIP target, not the four-hour Low one
  // — US-67, AC3, reaching through to the clock.
  assert.equal(policy?.nameEn, 'VIP');
  assert.equal(policy.resolutionMinutes, 240);
});

// ---------------------------------------------------------------------------
// AC3 — pause and resume
// ---------------------------------------------------------------------------

test('AC3 — the resolution clock pauses and resumes, and the deadline moves with it', async () => {
  const id = await makeTicket({ priority: 'MEDIUM' });

  await clock.applyOnCreate(id);

  const before = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionDueAt: true },
  });

  await clock.onStatusChange(id, 'OPEN', 'PENDING_CUSTOMER');

  const paused = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { slaPausedAt: true, slaPausedMs: true },
  });

  assert.ok(paused.slaPausedAt !== null, 'the clock did not stop');
  assert.equal(paused.slaPausedMs, 0);

  // Backdate the pause so there is a measurable amount of it to resume from,
  // rather than sleeping for real in a test suite.
  await prisma.ticket.update({
    where: { id },
    data: { slaPausedAt: new Date(Date.now() - 30 * MINUTE) },
  });

  await clock.onStatusChange(id, 'PENDING_CUSTOMER', 'OPEN');

  const resumed = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { slaPausedAt: true, slaPausedMs: true, resolutionDueAt: true },
  });

  assert.equal(resumed.slaPausedAt, null, 'the clock did not restart');
  assert.ok(resumed.slaPausedMs >= 29 * MINUTE, 'the pause was not banked');

  const moved = resumed.resolutionDueAt!.getTime() - before.resolutionDueAt!.getTime();

  // The deadline moved by exactly what the clock was stopped for, give or take
  // the milliseconds the test itself took.
  assert.ok(Math.abs(moved - resumed.slaPausedMs) < 2000, `deadline moved by ${String(moved)}ms`);
});

test('AC3 — pausing an already-paused ticket does not restart the pause', async () => {
  const id = await makeTicket();

  await clock.applyOnCreate(id);
  await clock.onStatusChange(id, 'OPEN', 'PENDING_CUSTOMER');

  const first = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { slaPausedAt: true },
  });

  await clock.onStatusChange(id, 'PENDING_INTERNAL', 'PENDING_CUSTOMER');

  const second = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { slaPausedAt: true },
  });

  // A second stamp would silently hand the ticket back the time it had banked.
  assert.equal(second.slaPausedAt?.getTime(), first.slaPausedAt?.getTime());
});

// ---------------------------------------------------------------------------
// AC4 — response satisfied
// ---------------------------------------------------------------------------

test('AC4 — the first customer-facing agent reply stops the response clock', async () => {
  const id = await makeTicket({ priority: 'HIGH' });

  await clock.applyOnCreate(id);
  await clock.onAgentReply(id, { isInternal: false });

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstRespondedAt: true, firstResponseBreached: true },
  });

  assert.ok(ticket.firstRespondedAt !== null);
  assert.equal(ticket.firstResponseBreached, false);
});

test('AC4 — an internal note does not satisfy the response target', async () => {
  const id = await makeTicket({ priority: 'HIGH' });

  await clock.applyOnCreate(id);
  await clock.onAgentReply(id, { isInternal: true });

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstRespondedAt: true },
  });

  // An agent must not be able to meet a commitment to a customer by writing a
  // note the customer will never see.
  assert.equal(ticket.firstRespondedAt, null);
});

test('AC4 — a later reply does not move a response that already happened', async () => {
  const id = await makeTicket();

  await clock.applyOnCreate(id);

  const first = new Date(Date.now() - 10 * MINUTE);
  await clock.onAgentReply(id, { isInternal: false, at: first });
  await clock.onAgentReply(id, { isInternal: false });

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstRespondedAt: true },
  });

  assert.equal(ticket.firstRespondedAt?.getTime(), first.getTime());
});

test('AC4 — a reply after the target records the breach', async () => {
  // Six hours old on an Urgent policy, whose response target is fifteen minutes.
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 6 });

  await clock.applyOnCreate(id);
  await clock.onAgentReply(id, { isInternal: false });

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstResponseBreached: true },
  });

  assert.equal(ticket.firstResponseBreached, true);
});

// ---------------------------------------------------------------------------
// AC5 — the scheduled check
// ---------------------------------------------------------------------------

test('AC5 — the sweep flags a passed target and records it against the rule', async () => {
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 30 });

  await clock.applyOnCreate(id);
  await clock.sweep();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstResponseBreached: true, resolutionBreached: true },
  });

  assert.equal(ticket.resolutionBreached, true);
  assert.equal(ticket.firstResponseBreached, true);

  const entries = await prisma.ticketHistory.findMany({
    where: { ticketId: id, eventType: 'SLA_BREACHED' },
    select: { actorUserId: true, field: true, metadata: true },
  });

  assert.equal(entries.length, 2, 'both clocks should have recorded');

  for (const entry of entries) {
    // US-50, AC3 — nobody did this, so nobody is named.
    assert.equal(entry.actorUserId, null);
    assert.equal(
      (entry.metadata as { automationRule?: string } | null)?.automationRule,
      SLA_BREACH_RULE,
    );
  }
});

test('AC5 — running the sweep again changes nothing', async () => {
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 30 });

  await clock.applyOnCreate(id);
  await clock.sweep();

  const firstPass = await prisma.ticketHistory.count({
    where: { ticketId: id, eventType: 'SLA_BREACHED' },
  });

  await clock.sweep();

  const secondPass = await prisma.ticketHistory.count({
    where: { ticketId: id, eventType: 'SLA_BREACHED' },
  });

  // A repeatable job will occasionally run twice. A duplicate history entry
  // every minute would bury the timeline within a day.
  assert.equal(secondPass, firstPass);
});

test('AC5 — a resolved ticket is not swept', async () => {
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 30, status: 'RESOLVED' });

  await clock.applyOnCreate(id);
  await clock.sweep();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionBreached: true },
  });

  assert.equal(ticket.resolutionBreached, false);
});

test('AC5 — a ticket whose target has not passed is left alone', async () => {
  const id = await makeTicket({ priority: 'LOW' });

  await clock.applyOnCreate(id);
  await clock.sweep();

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionBreached: true, firstResponseBreached: true },
  });

  assert.equal(ticket.resolutionBreached, false);
  assert.equal(ticket.firstResponseBreached, false);
});

// ---------------------------------------------------------------------------
// AC6 — recalculation
// ---------------------------------------------------------------------------

test('AC6 — a priority change recomputes from the original start, not from now', async () => {
  const id = await makeTicket({ priority: 'LOW', hoursAgo: 5 });

  await clock.applyOnCreate(id);

  await prisma.ticket.update({ where: { id }, data: { priority: 'URGENT' } });
  await clock.onPriorityChange(id);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { createdAt: true, resolutionDueAt: true, slaPolicyId: true },
  });

  const policy = await policies.findById(ticket.slaPolicyId!);

  assert.equal(policy?.nameEn, 'Urgent');
  assert.equal(
    ticket.resolutionDueAt?.getTime(),
    ticket.createdAt.getTime() + policy.resolutionMinutes * MINUTE,
  );

  // Five hours old with a four-hour target: the new deadline is in the past.
  // Recomputing from now would have handed it four fresh hours.
  assert.ok(ticket.resolutionDueAt < new Date());
});

test('AC6 — the recomputed deadline honours time already spent paused', async () => {
  const id = await makeTicket({ priority: 'MEDIUM', hoursAgo: 2 });

  await clock.applyOnCreate(id);

  await prisma.ticket.update({ where: { id }, data: { slaPausedMs: 90 * MINUTE } });
  await prisma.ticket.update({ where: { id }, data: { priority: 'HIGH' } });
  await clock.onPriorityChange(id);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { createdAt: true, resolutionDueAt: true, slaPolicyId: true },
  });

  const policy = await policies.findById(ticket.slaPolicyId!);

  assert.equal(
    ticket.resolutionDueAt?.getTime(),
    ticket.createdAt.getTime() + policy!.resolutionMinutes * MINUTE + 90 * MINUTE,
  );
});

test('AC6 — a response clock that has already stopped is not moved', async () => {
  const id = await makeTicket({ priority: 'LOW' });

  await clock.applyOnCreate(id);
  await clock.onAgentReply(id, { isInternal: false });

  const before = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstResponseDueAt: true },
  });

  await prisma.ticket.update({ where: { id }, data: { priority: 'URGENT' } });
  await clock.onPriorityChange(id);

  const afterChange = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { firstResponseDueAt: true },
  });

  // Moving a target after the response has landed is rewriting history: the
  // ticket either met the commitment it was under at the time or it did not.
  assert.equal(afterChange.firstResponseDueAt?.getTime(), before.firstResponseDueAt?.getTime());
});

test('AC6 — a recomputation that pushes the deadline forward clears a stale breach', async () => {
  const id = await makeTicket({ priority: 'URGENT', hoursAgo: 6 });

  await clock.applyOnCreate(id);
  await clock.sweep();

  assert.equal(
    (await prisma.ticket.findUniqueOrThrow({ where: { id }, select: { resolutionBreached: true } }))
      .resolutionBreached,
    true,
  );

  // Six hours old, moved to Low: a seventy-two-hour target is nowhere near.
  await prisma.ticket.update({ where: { id }, data: { priority: 'LOW' } });
  await clock.onPriorityChange(id);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionBreached: true, resolutionDueAt: true },
  });

  assert.ok(ticket.resolutionDueAt! > new Date());
  assert.equal(ticket.resolutionBreached, false, 'the flag disagrees with the clock');
});

// ---------------------------------------------------------------------------
// The read path US-40 already had
// ---------------------------------------------------------------------------

test('the SLA state stops answering "none" once the clock is running', async () => {
  const id = await makeTicket({ priority: 'MEDIUM' });

  const beforeApply = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionDueAt: true },
  });
  assert.equal(beforeApply.resolutionDueAt, null);

  await clock.applyOnCreate(id);

  const afterApply = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { resolutionDueAt: true },
  });
  assert.ok(afterApply.resolutionDueAt !== null);
});
