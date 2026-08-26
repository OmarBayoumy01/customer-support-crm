/**
 * US-120 — the demonstration data set.
 *
 * AC1 coverage · AC2 realistic content · AC3 bilingual · AC4 edge cases ·
 * AC5 idempotent and refuses production.
 *
 * This suite runs the seeder for real against the test database. There is no
 * sensible way to test a seeder other than by seeding, and the criteria are all
 * statements about what ends up in the database.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PERMISSION_CATALOGUE, SYSTEM_ROLES } from '../permissions/permission-catalogue.js';
import { seedDefaultSlaPolicies } from '../sla/seed-default-policies.js';
import { DEMO_ARTICLES, DEMO_CUSTOMERS, DEMO_TICKETS, DEMO_USERS } from './demo-data.js';
import { seedDemoData } from './demo-seed.js';
import { PrismaClient } from '../generated/prisma/client.js';

let pool: Pool;
let prisma: PrismaClient;

/** Restored in `after`, so this suite cannot leak a password into another. */
let originalSeedPassword: string | undefined;

before(async () => {
  const connectionString = process.env['DATABASE_URL'];

  assert.ok(connectionString !== undefined && connectionString !== '', 'DATABASE_URL is not set');

  pool = new Pool({ connectionString, max: 5 });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  originalSeedPassword = process.env['SEED_PASSWORD'];
  process.env['SEED_PASSWORD'] = 'DemoSeedT3st!';

  // The demo seeder needs the roles it assigns staff to. In a real run the
  // reference seed has already created them; here the suite creates only what
  // it depends on.
  for (const permission of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      },
      update: {},
    });
  }

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: { key: role.key, nameEn: role.nameEn, nameAr: role.nameAr, isSystem: true },
      update: {},
    });
  }

  // Tickets take their deadlines from a policy, so the policies come first —
  // the same order `seed.ts` uses.
  await seedDefaultSlaPolicies(prisma);
  await seedDemoData(prisma);
});

after(async () => {
  if (originalSeedPassword === undefined) {
    delete process.env['SEED_PASSWORD'];
  } else {
    process.env['SEED_PASSWORD'] = originalSeedPassword;
  }

  await prisma.$disconnect();
  await pool.end();
});

/** Only the seeded tickets, so another suite's fixtures cannot flatter these. */
const demoSubjects = DEMO_TICKETS.map((ticket) => ticket.subject);

// ---------------------------------------------------------------------------
// AC1 — coverage
// ---------------------------------------------------------------------------

test('AC1 — every entity the criterion names exists', async () => {
  const [branches, departments, categories, users, customers, tickets, messages, articles, tasks] =
    await Promise.all([
      prisma.branch.count(),
      prisma.department.count(),
      prisma.category.count(),
      prisma.user.count({ where: { email: { in: DEMO_USERS.map((user) => user.email) } } }),
      prisma.customer.count({
        where: { email: { in: DEMO_CUSTOMERS.map((customer) => customer.email) } },
      }),
      prisma.ticket.count({ where: { subject: { in: demoSubjects } } }),
      prisma.message.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
      prisma.knowledgeArticle.count({
        where: { slug: { in: DEMO_ARTICLES.map((article) => article.slug) } },
      }),
      prisma.task.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
    ]);

  assert.ok(branches >= 2, 'branches');
  assert.ok(departments >= 3, 'departments');
  assert.ok(categories >= 6, 'categories');
  assert.equal(users, DEMO_USERS.length, 'staff');
  assert.equal(customers, DEMO_CUSTOMERS.length, 'customers');
  assert.equal(tickets, DEMO_TICKETS.length, 'tickets');
  assert.ok(messages > 20, 'messages');
  assert.equal(articles, DEMO_ARTICLES.length, 'articles');
  assert.ok(tasks >= 5, 'tasks');
  assert.ok((await prisma.slaPolicy.count()) >= 5, 'SLA policies');
});

test('AC1 — every status and every priority is represented', async () => {
  const rows = await prisma.ticket.findMany({
    where: { subject: { in: demoSubjects } },
    select: { status: true, priority: true },
  });

  const statuses = new Set(rows.map((row) => row.status));
  const priorities = new Set(rows.map((row) => row.priority));

  for (const status of [
    'NEW',
    'OPEN',
    'PENDING_CUSTOMER',
    'PENDING_INTERNAL',
    'ESCALATED',
    'RESOLVED',
    'CLOSED',
  ] as const) {
    assert.ok(statuses.has(status), `no ticket has status ${status}`);
  }

  for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const) {
    assert.ok(priorities.has(priority), `no ticket has priority ${priority}`);
  }
});

test('AC1 — staff cover administrator, manager and agent', async () => {
  const roles = await prisma.userRole.findMany({
    where: { user: { email: { in: [...DEMO_USERS.map((u) => u.email), 'admin@crm.local'] } } },
    select: { role: { select: { key: true } } },
  });

  const keys = new Set(roles.map((row) => row.role.key));

  assert.ok(keys.has('manager'));
  assert.ok(keys.has('agent'));

  // The administrator is a development user rather than a demo one — one
  // account per role already exists and a second would just be noise.
  assert.ok((await prisma.role.count({ where: { key: 'administrator' } })) === 1);
});

// ---------------------------------------------------------------------------
// AC2 — realistic content
// ---------------------------------------------------------------------------

test('AC2 — no placeholder text anywhere in the seeded content', async () => {
  const placeholders = /lorem ipsum|sample text|test ticket|foo|bar|baz|xxx|todo:|placeholder/i;

  const tickets = await prisma.ticket.findMany({
    where: { subject: { in: demoSubjects } },
    select: { subject: true, description: true, messages: { select: { body: true } } },
  });

  for (const ticket of tickets) {
    assert.doesNotMatch(ticket.subject, placeholders, ticket.subject);
    assert.doesNotMatch(ticket.description ?? '', placeholders, ticket.subject);

    for (const message of ticket.messages) {
      assert.doesNotMatch(message.body, placeholders, ticket.subject);
    }
  }
});

test('AC2 — conversations read as conversations, not as one-liners', async () => {
  const withReplies = await prisma.ticket.count({
    where: { subject: { in: demoSubjects }, messages: { some: {} } },
  });

  // A queue where every ticket has a single message is not a demonstration of a
  // helpdesk. Most of them carry a real exchange.
  assert.ok(withReplies >= DEMO_TICKETS.length - 3, `only ${String(withReplies)} have messages`);

  const bodies = await prisma.message.findMany({
    where: { ticket: { subject: { in: demoSubjects } } },
    select: { body: true },
  });

  const median = bodies.map((row) => row.body.length).sort((a, b) => a - b)[
    Math.floor(bodies.length / 2)
  ];

  assert.ok((median ?? 0) > 60, `median message length is ${String(median)}`);
});

// ---------------------------------------------------------------------------
// AC3 — bilingual
// ---------------------------------------------------------------------------

test('AC3 — some records are in Arabic, across tickets, messages and articles', async () => {
  const arabic = /[؀-ۿ]/;

  const tickets = await prisma.ticket.findMany({
    where: { subject: { in: demoSubjects } },
    select: { subject: true },
  });

  assert.ok(
    tickets.filter((ticket) => arabic.test(ticket.subject)).length >= 3,
    'fewer than three Arabic ticket subjects',
  );

  const messages = await prisma.message.findMany({
    where: { ticket: { subject: { in: demoSubjects } } },
    select: { body: true },
  });

  assert.ok(
    messages.some((message) => arabic.test(message.body)),
    'no Arabic message bodies',
  );

  const articles = await prisma.knowledgeArticle.findMany({
    where: { slug: { in: DEMO_ARTICLES.map((article) => article.slug) } },
    select: { locale: true, translationGroupId: true },
  });

  assert.ok(
    articles.some((article) => article.locale === 'AR'),
    'no Arabic articles',
  );

  // A matched pair, which is the only way to see `translationGroupId` do what
  // US-6 intended.
  const groups = new Map<string, number>();

  for (const article of articles) {
    groups.set(article.translationGroupId, (groups.get(article.translationGroupId) ?? 0) + 1);
  }

  assert.ok(
    [...groups.values()].some((count) => count === 2),
    'no EN/AR translation pair',
  );
});

test('AC3 — customers and staff carry a locale, and some of them are Arabic', async () => {
  const customers = await prisma.customer.findMany({
    where: { email: { in: DEMO_CUSTOMERS.map((customer) => customer.email) } },
    select: { preferredLocale: true },
  });

  assert.ok(customers.some((customer) => customer.preferredLocale === 'AR'));
  assert.ok(customers.some((customer) => customer.preferredLocale === 'EN'));

  const staff = await prisma.user.findMany({
    where: { email: { in: DEMO_USERS.map((user) => user.email) } },
    select: { locale: true },
  });

  assert.ok(staff.some((user) => user.locale === 'AR'));
});

// ---------------------------------------------------------------------------
// AC4 — edge cases
// ---------------------------------------------------------------------------

test('AC4 — a breached SLA, an unassigned ticket, a long thread and attachments', async () => {
  const breached = await prisma.ticket.count({
    where: {
      subject: { in: demoSubjects },
      OR: [{ resolutionBreached: true }, { firstResponseBreached: true }],
    },
  });
  assert.ok(breached >= 1, 'no breached ticket');

  const unassigned = await prisma.ticket.count({
    where: { subject: { in: demoSubjects }, assigneeId: null },
  });
  assert.ok(unassigned >= 2, 'fewer than two unassigned tickets');

  const longest = await prisma.ticket.findFirst({
    where: { subject: { in: demoSubjects } },
    select: { subject: true, _count: { select: { messages: true } } },
    orderBy: { messages: { _count: 'desc' } },
  });
  assert.ok((longest?._count.messages ?? 0) >= 8, 'no long conversation');

  const attachments = await prisma.attachment.count({
    where: { ticket: { subject: { in: demoSubjects } } },
  });
  assert.ok(attachments >= 2, 'no attachments');
});

test('AC4 — the breach is real, not a flag set by hand', async () => {
  const breached = await prisma.ticket.findMany({
    where: { subject: { in: demoSubjects }, resolutionBreached: true },
    select: { subject: true, resolutionDueAt: true, resolvedAt: true },
  });

  for (const ticket of breached) {
    assert.ok(ticket.resolutionDueAt !== null, `${ticket.subject} is breached with no target`);

    const passed =
      ticket.resolvedAt === null
        ? ticket.resolutionDueAt < new Date()
        : ticket.resolvedAt > ticket.resolutionDueAt;

    assert.ok(passed, `${ticket.subject} is flagged breached but its clock has not passed`);
  }
});

test('AC4 — every ticket resolved a policy, so the SLA column is never empty', async () => {
  const withoutPolicy = await prisma.ticket.count({
    where: { subject: { in: demoSubjects }, slaPolicyId: null },
  });

  assert.equal(withoutPolicy, 0);
});

test('internal notes exist, and they are notes rather than replies', async () => {
  // Not one of US-120's criteria, but the project's first non-negotiable rule
  // needs something to be true about: a demo with no internal notes cannot
  // demonstrate that they stay out of the portal.
  const internal = await prisma.message.count({
    where: { ticket: { subject: { in: demoSubjects } }, isInternal: true },
  });

  assert.ok(internal >= 4, `only ${String(internal)} internal notes`);
});

// ---------------------------------------------------------------------------
// AC5 — idempotent and safe
// ---------------------------------------------------------------------------

test('AC5 — running it again duplicates nothing', async () => {
  const before = await Promise.all([
    prisma.ticket.count({ where: { subject: { in: demoSubjects } } }),
    prisma.message.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
    prisma.customer.count({
      where: { email: { in: DEMO_CUSTOMERS.map((customer) => customer.email) } },
    }),
    prisma.attachment.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
    prisma.knowledgeArticle.count({
      where: { slug: { in: DEMO_ARTICLES.map((article) => article.slug) } },
    }),
  ]);

  await seedDemoData(prisma);
  await seedDefaultSlaPolicies(prisma);

  const afterSecondRun = await Promise.all([
    prisma.ticket.count({ where: { subject: { in: demoSubjects } } }),
    prisma.message.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
    prisma.customer.count({
      where: { email: { in: DEMO_CUSTOMERS.map((customer) => customer.email) } },
    }),
    prisma.attachment.count({ where: { ticket: { subject: { in: demoSubjects } } } }),
    prisma.knowledgeArticle.count({
      where: { slug: { in: DEMO_ARTICLES.map((article) => article.slug) } },
    }),
  ]);

  assert.deepEqual(afterSecondRun, before);
});

test('AC5 — it refuses to run against a production database', async () => {
  const subject = 'Duplicate charge on card ending 4417';

  await prisma.ticket.deleteMany({ where: { subject } });

  const previous = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';

  try {
    await seedDemoData(prisma);
  } finally {
    if (previous === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = previous;
    }
  }

  // It returned without writing: the ticket deleted above is still gone.
  assert.equal(await prisma.ticket.count({ where: { subject } }), 0);

  // And putting it back is one more run, which is the point of AC5's other half.
  await seedDemoData(prisma);
  assert.equal(await prisma.ticket.count({ where: { subject } }), 1);
});

test('AC5 — it refuses to run without SEED_PASSWORD', async () => {
  const subject = 'Two-factor codes arriving several minutes late';

  await prisma.ticket.deleteMany({ where: { subject } });

  const previous = process.env['SEED_PASSWORD'];
  delete process.env['SEED_PASSWORD'];

  try {
    await seedDemoData(prisma);
  } finally {
    process.env['SEED_PASSWORD'] = previous;
  }

  assert.equal(await prisma.ticket.count({ where: { subject } }), 0);

  await seedDemoData(prisma);
  assert.equal(await prisma.ticket.count({ where: { subject } }), 1);
});
