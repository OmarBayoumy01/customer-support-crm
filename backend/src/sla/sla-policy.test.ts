/**
 * US-67 — SLA policies.
 *
 * AC1 the fields a policy stores · AC2 the most specific match wins ·
 * AC3 a VIP policy beats a general one · AC4 editing a policy does not move a
 * deadline already set · AC5 the change is audited with before and after.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CreateSlaPolicy, SlaTicketFacts } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { SlaPolicyService } from './sla-policy.service.js';
import { specificityOf } from './sla-specificity.js';

let app: INestApplication;
let prisma: PrismaService;
let policies: SlaPolicyService;

const run = randomUUID().slice(0, 8);

let departmentId: string;
let branchId: string;
let categoryId: string;
let actorUserId: string;

/** Every policy this suite creates, so it can clean up after itself. */
const created: string[] = [];

/**
 * A policy, created through the service.
 *
 * `isActive` and `businessHoursOnly` carry Zod defaults, which the service does
 * not apply — it receives an already-parsed value — so the tests state them.
 */
async function makePolicy(overrides: Partial<CreateSlaPolicy> = {}): Promise<string> {
  const policy = await policies.create(
    {
      nameEn: `Policy ${run} ${String(created.length)}`,
      nameAr: 'سياسة',
      firstResponseMinutes: 60,
      resolutionMinutes: 480,
      businessHoursOnly: false,
      isActive: true,
      escalationSteps: [],
      ...overrides,
    },
    actorUserId,
  );

  created.push(policy.id);

  return policy.id;
}

/**
 * A department nobody else is using.
 *
 * This story's migration adds a unique index over the six matchers with
 * `NULLS NOT DISTINCT`, so two tests that both create a "department only" policy
 * are a genuine constraint violation rather than a test-isolation nicety. Each
 * test therefore matches on scenery of its own.
 */
async function newDepartment(): Promise<string> {
  const row = await prisma.department.create({
    data: { code: `SLA-D-${run}-${String(scenery++)}`, nameEn: 'Dept', nameAr: 'قسم' },
    select: { id: true },
  });

  return row.id;
}

async function newBranch(): Promise<string> {
  const row = await prisma.branch.create({
    data: { code: `SLA-B-${run}-${String(scenery++)}`, nameEn: 'Branch', nameAr: 'فرع' },
    select: { id: true },
  });

  return row.id;
}

let scenery = 0;

/** A ticket that matches nothing in particular. */
function facts(overrides: Partial<SlaTicketFacts> = {}): SlaTicketFacts {
  return {
    priority: 'MEDIUM',
    categoryId: null,
    departmentId: null,
    branchId: null,
    customerType: 'INDIVIDUAL',
    customerIsVip: false,
    ...overrides,
  };
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
  policies = app.get(SlaPolicyService);

  const branch = await prisma.branch.create({
    data: { code: `SLA-B-${run}`, nameEn: 'Riyadh', nameAr: 'الرياض' },
    select: { id: true },
  });
  branchId = branch.id;

  const department = await prisma.department.create({
    data: { code: `SLA-D-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });
  departmentId = department.id;

  const category = await prisma.category.create({
    data: { slug: `billing-${run}`, nameEn: `Billing ${run}`, nameAr: 'الفوترة' },
    select: { id: true },
  });
  categoryId = category.id;

  const user = await prisma.user.create({
    data: {
      email: `sla-${run}@example.com`,
      passwordHash: 'irrelevant',
      firstName: 'Sara',
      lastName: `Policy-${run}`,
    },
    select: { id: true },
  });
  actorUserId = user.id;
});

after(async () => {
  // The seeded platform policies stay; only this run's do not. Leaving them
  // would make every later run's "most specific match" depend on how many times
  // the suite had been run before.
  await prisma.slaPolicy.deleteMany({ where: { id: { in: created } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — what a policy stores
// ---------------------------------------------------------------------------

test('AC1 — a policy stores every field the criterion names', async () => {
  const policy = await policies.create(
    {
      nameEn: `Full ${run}`,
      nameAr: 'كاملة',
      priority: 'HIGH',
      categoryId,
      departmentId,
      branchId,
      customerType: 'COMPANY',
      customerIsVip: false,
      firstResponseMinutes: 30,
      resolutionMinutes: 240,
      businessHoursOnly: true,
      isActive: true,
      escalationSteps: [
        {
          sequence: 0,
          clock: 'RESOLUTION',
          atPercent: 75,
          notify: 'ASSIGNEE',
          changeStatusToEscalated: false,
        },
        {
          sequence: 1,
          clock: 'RESOLUTION',
          atPercent: 100,
          notify: 'DEPARTMENT_MANAGER',
          changeStatusToEscalated: true,
        },
      ],
    },
    actorUserId,
  );

  created.push(policy.id);

  assert.equal(policy.nameEn, `Full ${run}`);
  assert.equal(policy.firstResponseMinutes, 30);
  assert.equal(policy.resolutionMinutes, 240);
  assert.equal(policy.businessHoursOnly, true);
  assert.equal(policy.isActive, true);
  assert.equal(policy.priority, 'HIGH');
  assert.equal(policy.categoryId, categoryId);
  assert.equal(policy.departmentId, departmentId);
  assert.equal(policy.branchId, branchId);
  assert.equal(policy.customerType, 'COMPANY');
  assert.equal(policy.escalationSteps.length, 2);
  assert.equal(policy.escalationSteps[1]!.changeStatusToEscalated, true);

  // Derived on write, so nothing has to recompute it on read.
  assert.equal(
    policy.specificity,
    specificityOf({
      priority: 'HIGH',
      categoryId,
      departmentId,
      branchId,
      customerType: 'COMPANY',
      customerIsVip: false,
    }),
  );
});

// ---------------------------------------------------------------------------
// AC2 — applicability
// ---------------------------------------------------------------------------

test('AC2 — the most specific matching policy wins', async () => {
  const department = await newDepartment();

  const broad = await makePolicy({ departmentId: department, resolutionMinutes: 999 });
  const narrow = await makePolicy({
    departmentId: department,
    priority: 'HIGH',
    resolutionMinutes: 111,
  });

  const resolved = await policies.resolveFor(facts({ priority: 'HIGH', departmentId: department }));

  assert.equal(resolved?.id, narrow);
  assert.notEqual(resolved?.id, broad);
});

test('AC2 — a policy whose matcher disagrees is not chosen', async () => {
  const branch = await newBranch();

  await makePolicy({ branchId: branch, resolutionMinutes: 222 });

  const resolved = await policies.resolveFor(facts({ branchId: null }));

  assert.notEqual(resolved?.resolutionMinutes, 222);
});

test('AC2 — every dimension the criterion names can match', async () => {
  const department = await newDepartment();
  const branch = await newBranch();

  for (const matcher of [
    { priority: 'URGENT' as const },
    { categoryId },
    { departmentId: department },
    { branchId: branch },
    { customerType: 'COMPANY' as const },
  ]) {
    const id = await makePolicy({ ...matcher, resolutionMinutes: 4321 });

    const resolved = await policies.resolveFor(
      facts({
        priority: 'URGENT',
        categoryId,
        departmentId: department,
        branchId: branch,
        customerType: 'COMPANY',
      }),
    );

    assert.equal(
      resolved?.resolutionMinutes,
      4321,
      `matching on ${Object.keys(matcher)[0]!} did not resolve`,
    );

    // Removed again so the next iteration is not competing with this one.
    await prisma.slaPolicy.delete({ where: { id } });
  }
});

test('AC2 — an inactive policy never wins, however specific', async () => {
  const department = await newDepartment();
  const branch = await newBranch();

  await makePolicy({
    priority: 'LOW',
    categoryId,
    departmentId: department,
    branchId: branch,
    isActive: false,
    resolutionMinutes: 777,
  });

  const resolved = await policies.resolveFor(
    facts({ priority: 'LOW', categoryId, departmentId: department, branchId: branch }),
  );

  assert.notEqual(resolved?.resolutionMinutes, 777);
});

test('AC2 — an archived policy never wins either', async () => {
  const department = await newDepartment();

  const id = await makePolicy({
    departmentId: department,
    priority: 'LOW',
    resolutionMinutes: 888,
  });

  await policies.archive(id, actorUserId);

  const resolved = await policies.resolveFor(facts({ priority: 'LOW', departmentId: department }));

  assert.notEqual(resolved?.resolutionMinutes, 888);
});

// ---------------------------------------------------------------------------
// AC3 — VIP override
// ---------------------------------------------------------------------------

test('AC3 — a VIP policy beats a general policy with more matchers', async () => {
  const department = await newDepartment();
  const branch = await newBranch();

  // The general policy sets three matchers; the VIP policy sets two, one of
  // which is VIP. Counting matchers would pick the general one, which is
  // exactly the bug the weights exist to prevent.
  await makePolicy({
    priority: 'LOW',
    departmentId: department,
    branchId: branch,
    resolutionMinutes: 5000,
  });

  const vip = await makePolicy({
    customerIsVip: true,
    branchId: branch,
    resolutionMinutes: 240,
  });

  const resolved = await policies.resolveFor(
    facts({
      priority: 'LOW',
      departmentId: department,
      branchId: branch,
      customerIsVip: true,
    }),
  );

  assert.equal(resolved?.id, vip);
  assert.equal(resolved?.resolutionMinutes, 240);
});

test('AC3 — a non-VIP customer does not get the VIP policy', async () => {
  const branch = await newBranch();

  await makePolicy({ customerIsVip: true, branchId: branch, resolutionMinutes: 241 });

  const resolved = await policies.resolveFor(facts({ branchId: branch, customerIsVip: false }));

  assert.notEqual(resolved?.resolutionMinutes, 241);
});

// ---------------------------------------------------------------------------
// AC4 — nothing shifts retroactively
// ---------------------------------------------------------------------------

test('AC4 — editing a policy leaves an existing ticket’s deadlines alone', async () => {
  const department = await newDepartment();
  const policyId = await makePolicy({
    departmentId: department,
    priority: 'HIGH',
    resolutionMinutes: 480,
  });

  const customer = await prisma.customer.create({
    data: { firstName: 'Layla', lastName: `Ahmad-${run}` },
    select: { id: true },
  });

  const dueAt = new Date('2026-09-01T12:00:00.000Z');

  const ticket = await prisma.ticket.create({
    data: {
      subject: `SLA ${run}`,
      customerId: customer.id,
      priority: 'HIGH',
      departmentId: department,
      slaPolicyId: policyId,
      firstResponseDueAt: dueAt,
      resolutionDueAt: dueAt,
    },
    select: { id: true },
  });

  await policies.update(policyId, { resolutionMinutes: 15, firstResponseMinutes: 5 }, actorUserId);

  const after = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { firstResponseDueAt: true, resolutionDueAt: true, slaPolicyId: true },
  });

  // The deadlines are absolute timestamps written when the policy was applied.
  // Editing the policy cannot move them, and the ticket still names the policy
  // it was governed by.
  assert.equal(after.firstResponseDueAt?.toISOString(), dueAt.toISOString());
  assert.equal(after.resolutionDueAt?.toISOString(), dueAt.toISOString());
  assert.equal(after.slaPolicyId, policyId);

  await prisma.ticket.delete({ where: { id: ticket.id } });
});

// ---------------------------------------------------------------------------
// AC5 — audit
// ---------------------------------------------------------------------------

test('AC5 — creating a policy is audited', async () => {
  const id = await makePolicy({ resolutionMinutes: 333, departmentId: await newDepartment() });

  const entry = await prisma.auditLog.findFirstOrThrow({
    where: { entityType: 'SlaPolicy', entityId: id, action: 'CREATE' },
  });

  assert.equal(entry.actorUserId, actorUserId);
  assert.equal(entry.before, null);
  assert.equal((entry.after as { resolutionMinutes: number }).resolutionMinutes, 333);
});

test('AC5 — an update is audited with before and after, and only what changed', async () => {
  const id = await makePolicy({
    resolutionMinutes: 600,
    departmentId: await newDepartment(),
    priority: 'URGENT',
  });

  await policies.update(id, { resolutionMinutes: 900 }, actorUserId);

  const entry = await prisma.auditLog.findFirstOrThrow({
    where: { entityType: 'SlaPolicy', entityId: id, action: 'UPDATE' },
    orderBy: { createdAt: 'desc' },
  });

  const before = entry.before as Record<string, unknown>;
  const afterValues = entry.after as Record<string, unknown>;

  assert.equal(before['resolutionMinutes'], 600);
  assert.equal(afterValues['resolutionMinutes'], 900);

  // A diff, not two copies of the row. `nameEn` did not change, so it is not
  // here, and a reader can see what happened without comparing by eye.
  assert.deepEqual(Object.keys(afterValues), ['resolutionMinutes']);
});

test('AC5 — a save that changed nothing writes no audit entry', async () => {
  const id = await makePolicy({
    resolutionMinutes: 444,
    departmentId: await newDepartment(),
    priority: 'LOW',
  });

  await policies.update(id, { resolutionMinutes: 444 }, actorUserId);

  const count = await prisma.auditLog.count({
    where: { entityType: 'SlaPolicy', entityId: id, action: 'UPDATE' },
  });

  assert.equal(count, 0);
});

// ---------------------------------------------------------------------------
// The unique index the migration adds
// ---------------------------------------------------------------------------

test('two policies matching exactly the same thing are refused by the database', async () => {
  const branch = await newBranch();

  await makePolicy({ priority: 'MEDIUM', branchId: branch, categoryId });

  await assert.rejects(makePolicy({ priority: 'MEDIUM', branchId: branch, categoryId }));
});
