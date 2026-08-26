/**
 * Turns `demo-data.ts` into rows — US-120.
 *
 * Runs outside Nest, like the rest of the seeder, so it reads `process.env` and
 * writes to the console directly.
 *
 * **AC5 has two halves and they are different guarantees.** "Refuses to run
 * against production" is a guard at the top of `seedDemoData`. "Does not
 * duplicate" is per-record: every entity is looked up by a natural key and
 * updated rather than inserted again. The second is what makes the first
 * survivable — a half-finished run can simply be repeated.
 */
/* eslint-disable no-process-env */
import argon2 from 'argon2';

import { SLA_CANDIDATE_ORDER, slaCandidateWhere } from '../sla/sla-matching.js';
import {
  DEMO_ARTICLES,
  DEMO_BRANCHES,
  DEMO_CATEGORIES,
  DEMO_CUSTOMERS,
  DEMO_DEPARTMENTS,
  DEMO_TICKETS,
  DEMO_USERS,
  type DemoTicket,
} from './demo-data.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** Minutes to milliseconds, spelled out so the arithmetic below reads. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The demo data is fiction, but it is fiction that logs in.
 *
 * Demo agents get the same password as the development users, from the same
 * variable, for the same reason: a password constant in this file is a back
 * door, and a default invented here would be the same back door one environment
 * variable later.
 */
function demoPassword(): string | null {
  const password = process.env['SEED_PASSWORD'];

  return password === undefined || password === '' ? null : password;
}

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  // AC5, first half. Demonstration data on a live helpdesk is invented tickets
  // from invented customers sitting in a real agent's queue.
  if (process.env['NODE_ENV'] === 'production') {
    console.log('\nSkipping demo data: NODE_ENV is production.');
    return;
  }

  const password = demoPassword();

  if (password === null) {
    console.log('\nSkipping demo data: SEED_PASSWORD is not set.');
    return;
  }

  console.log('');

  // --- Branches ------------------------------------------------------------
  const branchIdByCode = new Map<string, string>();

  for (const branch of DEMO_BRANCHES) {
    const row = await prisma.branch.upsert({
      where: { code: branch.code },
      create: {
        code: branch.code,
        nameEn: branch.nameEn,
        nameAr: branch.nameAr,
        timezone: branch.timezone,
      },
      update: { nameEn: branch.nameEn, nameAr: branch.nameAr, timezone: branch.timezone },
      select: { id: true },
    });

    branchIdByCode.set(branch.code, row.id);
  }

  // --- Departments ---------------------------------------------------------
  const departmentIdByCode = new Map<string, string>();

  for (const department of DEMO_DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { code: department.code },
      create: {
        code: department.code,
        nameEn: department.nameEn,
        nameAr: department.nameAr,
        branchId: branchIdByCode.get(department.branch) ?? null,
      },
      update: {
        nameEn: department.nameEn,
        nameAr: department.nameAr,
        branchId: branchIdByCode.get(department.branch) ?? null,
      },
      select: { id: true },
    });

    departmentIdByCode.set(department.code, row.id);
  }

  // --- Categories ----------------------------------------------------------
  const categoryIdBySlug = new Map<string, string>();

  for (const category of DEMO_CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        nameEn: category.nameEn,
        nameAr: category.nameAr,
        departmentId: departmentIdByCode.get(category.department) ?? null,
        defaultPriority: category.defaultPriority ?? null,
      },
      update: {
        nameEn: category.nameEn,
        nameAr: category.nameAr,
        departmentId: departmentIdByCode.get(category.department) ?? null,
        defaultPriority: category.defaultPriority ?? null,
      },
      select: { id: true },
    });

    categoryIdBySlug.set(category.slug, row.id);
  }

  // --- Staff ---------------------------------------------------------------
  const roleIdByKey = new Map(
    (await prisma.role.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  );

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const userIdByEmail = new Map<string, string>();

  for (const user of DEMO_USERS) {
    const roleId = roleIdByKey.get(user.role);

    if (roleId === undefined) {
      throw new Error(`Role "${user.role}" is missing; cannot seed ${user.email}`);
    }

    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        email: user.email,
        passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        departmentId: departmentIdByCode.get(user.department) ?? null,
        branchId: branchIdByCode.get(user.branch) ?? null,
      },
      // Never touches `passwordHash` — a re-run must not reset a password
      // somebody has since changed.
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        departmentId: departmentIdByCode.get(user.department) ?? null,
        branchId: branchIdByCode.get(user.branch) ?? null,
      },
      select: { id: true },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: row.id, roleId } },
      create: { userId: row.id, roleId },
      update: {},
    });

    userIdByEmail.set(user.email, row.id);
  }

  // The technical department gets a manager, so US-71's DEPARTMENT_MANAGER
  // escalation target resolves to somebody rather than to nothing.
  const technicalManagerId = userIdByEmail.get('khalid.otaibi@crm.local');
  const technicalDepartmentId = departmentIdByCode.get('TEC');

  if (technicalManagerId !== undefined && technicalDepartmentId !== undefined) {
    await prisma.department.update({
      where: { id: technicalDepartmentId },
      data: { managerId: technicalManagerId },
    });
  }

  // --- Customers -----------------------------------------------------------
  const customerIdByKey = new Map<string, string>();

  for (const customer of DEMO_CUSTOMERS) {
    // `email` is indexed but not unique — a household can share one — so this
    // is find-then-write rather than an upsert.
    const found = await prisma.customer.findFirst({
      where: { email: customer.email },
      select: { id: true },
    });

    const data = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      companyName: customer.companyName ?? null,
      type: customer.type,
      isVip: customer.isVip,
      preferredLocale: customer.locale,
      branchId: branchIdByCode.get(customer.branch) ?? null,
    };

    const row =
      found === null
        ? await prisma.customer.create({ data, select: { id: true } })
        : await prisma.customer.update({ where: { id: found.id }, data, select: { id: true } });

    customerIdByKey.set(customer.key, row.id);
  }

  // --- Tickets -------------------------------------------------------------
  let ticketsCreated = 0;

  for (const ticket of DEMO_TICKETS) {
    const customerId = customerIdByKey.get(ticket.customer);

    if (customerId === undefined) {
      throw new Error(`Ticket "${ticket.subject}" names customer "${ticket.customer}"`);
    }

    // The subject is the natural key. It is distinctive by construction — these
    // are written, not generated — and scoping it to the customer means two
    // people can still raise the same complaint.
    const existing = await prisma.ticket.findFirst({
      where: { subject: ticket.subject, customerId },
      select: { id: true },
    });

    if (existing !== null) {
      continue;
    }

    await createDemoTicket(prisma, ticket, {
      customerId,
      categoryIdBySlug,
      departmentIdByCode,
      branchIdByCode,
      userIdByEmail,
    });

    ticketsCreated += 1;
  }

  // --- Knowledge base ------------------------------------------------------
  const authorId = userIdByEmail.get('tom.becker@crm.local') ?? null;

  for (const article of DEMO_ARTICLES) {
    const data = {
      translationGroupId: `demo-${article.translationGroup}`,
      locale: article.locale,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      body: article.body,
      categoryId: categoryIdBySlug.get(article.category) ?? null,
      status: article.status,
      authorId,
      publishedAt: article.status === 'PUBLISHED' ? new Date() : null,
    };

    await prisma.knowledgeArticle.upsert({
      where: { locale_slug: { locale: article.locale, slug: article.slug } },
      create: data,
      update: data,
    });
  }

  console.log(
    `Seeded demo data: ${String(DEMO_BRANCHES.length)} branches, ` +
      `${String(DEMO_DEPARTMENTS.length)} departments, ${String(DEMO_CATEGORIES.length)} categories, ` +
      `${String(DEMO_USERS.length)} staff, ${String(DEMO_CUSTOMERS.length)} customers, ` +
      `${String(DEMO_ARTICLES.length)} articles.`,
  );
  console.log(
    ticketsCreated === 0
      ? `Demo tickets already present (${String(DEMO_TICKETS.length)}); nothing re-created.`
      : `Seeded ${String(ticketsCreated)} demo tickets with conversations, attachments and tasks.`,
  );
}

interface TicketContext {
  customerId: string;
  categoryIdBySlug: Map<string, string>;
  departmentIdByCode: Map<string, string>;
  branchIdByCode: Map<string, string>;
  userIdByEmail: Map<string, string>;
}

/**
 * One ticket, its conversation, its attachments, its tasks, and its SLA.
 *
 * Timestamps are computed backwards from now so that a freshly seeded database
 * has tickets at every stage of their life — some minutes old, some breached
 * days ago — rather than fourteen tickets all created at the same instant.
 */
async function createDemoTicket(
  prisma: PrismaClient,
  ticket: DemoTicket,
  context: TicketContext,
): Promise<void> {
  const category = DEMO_CATEGORIES.find((row) => row.slug === ticket.category);
  const categoryId = context.categoryIdBySlug.get(ticket.category) ?? null;
  const departmentId =
    category === undefined ? null : (context.departmentIdByCode.get(category.department) ?? null);
  const branchId =
    category === undefined
      ? null
      : (context.branchIdByCode.get(
          DEMO_DEPARTMENTS.find((row) => row.code === category.department)?.branch ?? '',
        ) ?? null);

  const assigneeId =
    ticket.assignee === null ? null : (context.userIdByEmail.get(ticket.assignee) ?? null);

  const createdAt = new Date(Date.now() - ticket.hoursAgo * HOUR);

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: context.customerId },
    select: { type: true, isVip: true },
  });

  // Resolved through exactly the query the application uses — US-67's
  // `slaCandidateWhere`. A demo whose SLA column disagrees with the API is
  // worse than a demo with no SLA at all.
  const policy = await prisma.slaPolicy.findFirst({
    where: slaCandidateWhere({
      priority: ticket.priority,
      categoryId,
      departmentId,
      branchId,
      customerType: customer.type,
      customerIsVip: customer.isVip,
    }),
    orderBy: SLA_CANDIDATE_ORDER,
    select: { id: true, firstResponseMinutes: true, resolutionMinutes: true },
  });

  const firstResponseDueAt =
    policy === null ? null : new Date(createdAt.getTime() + policy.firstResponseMinutes * MINUTE);
  const resolutionDueAt =
    policy === null ? null : new Date(createdAt.getTime() + policy.resolutionMinutes * MINUTE);

  const firstAgentMessage = ticket.messages.find((message) => message.from === 'AGENT');
  const firstRespondedAt =
    firstAgentMessage === undefined
      ? null
      : new Date(createdAt.getTime() + firstAgentMessage.after * MINUTE);

  const lastCustomerMessage = [...ticket.messages]
    .reverse()
    .find((message) => message.from === 'CUSTOMER');
  const lastAgentMessage = [...ticket.messages]
    .reverse()
    .find((message) => message.from === 'AGENT' && message.isInternal !== true);

  const resolvedAt =
    ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
      ? new Date(createdAt.getTime() + 4 * HOUR)
      : null;

  const created = await prisma.ticket.create({
    data: {
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      channel: ticket.channel,
      customerId: context.customerId,
      assigneeId,
      categoryId,
      departmentId,
      branchId,
      tags: ticket.tags,
      slaPolicyId: policy?.id ?? null,
      firstResponseDueAt,
      firstRespondedAt,
      // AC4 — a real breach, not a flag set by hand. It is true exactly when
      // the clock says so, which is what US-68 will compute for live tickets.
      firstResponseBreached:
        firstResponseDueAt !== null &&
        (firstRespondedAt === null
          ? firstResponseDueAt < new Date()
          : firstRespondedAt > firstResponseDueAt),
      resolutionDueAt,
      resolutionBreached:
        resolutionDueAt !== null &&
        (resolvedAt === null ? resolutionDueAt < new Date() : resolvedAt > resolutionDueAt),
      resolvedAt,
      closedAt: ticket.status === 'CLOSED' ? new Date(createdAt.getTime() + 6 * HOUR) : null,
      escalatedAt: ticket.status === 'ESCALATED' ? new Date(createdAt.getTime() + 48 * HOUR) : null,
      lastCustomerReplyAt:
        lastCustomerMessage === undefined
          ? null
          : new Date(createdAt.getTime() + lastCustomerMessage.after * MINUTE),
      lastAgentReplyAt:
        lastAgentMessage === undefined
          ? null
          : new Date(createdAt.getTime() + lastAgentMessage.after * MINUTE),
      createdAt,
      history: {
        create: {
          eventType: 'CREATED',
          actorUserId: null,
          createdAt,
        },
      },
    },
    select: { id: true },
  });

  for (const message of ticket.messages) {
    const sentAt = new Date(createdAt.getTime() + message.after * MINUTE);

    const row = await prisma.message.create({
      data: {
        ticketId: created.id,
        isInternal: message.isInternal ?? false,
        senderType: message.from,
        authorUserId: message.from === 'AGENT' ? assigneeId : null,
        authorCustomerId: message.from === 'CUSTOMER' ? context.customerId : null,
        body: message.body,
        channel: ticket.channel,
        createdAt: sentAt,
      },
      select: { id: true },
    });

    for (const attachment of message.attachments ?? []) {
      await prisma.attachment.create({
        data: {
          messageId: row.id,
          ticketId: created.id,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          // No object is uploaded: storage is not wired up in the MVP, and a
          // key pointing at nothing is honest about that. The listing, the
          // size and the filename are what the ticket screen renders.
          storageKey: `demo/${created.id}/${row.id}/${attachment.fileName}`,
          uploadedById: message.from === 'AGENT' ? assigneeId : null,
          createdAt: sentAt,
        },
      });
    }
  }

  for (const task of ticket.tasks ?? []) {
    await prisma.task.create({
      data: {
        title: task.title,
        ticketId: created.id,
        assigneeId,
        status: task.status,
        priority: ticket.priority,
        completedAt: task.status === 'DONE' ? new Date(createdAt.getTime() + 5 * HOUR) : null,
        createdAt,
      },
    });
  }
}
