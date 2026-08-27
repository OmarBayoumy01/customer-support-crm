import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateCustomer,
  Customer,
  CustomerListQuery,
  CustomerStats,
  DuplicateCustomer,
  UpdateCustomer,
} from '@crm/shared';
import { buildPaginationMeta, toSkipTake, type ApiPaginated } from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';
import type { Prisma } from '../generated/prisma/client.js';

/** The columns every response is built from. Never `select: *`. */
const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  companyName: true,
  type: true,
  isVip: true,
  notes: true,
  preferredLocale: true,
  preferredChannel: true,
  departmentId: true,
  branchId: true,
  externalRef: true,
  isActive: true,
  createdAt: true,
} as const;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

/** The only status that means "done" — everything else is someone's problem. */
const RESOLVED = 'RESOLVED' as const;

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attaches the derived fields AC4 asks for.
   *
   * **One aggregate for the whole page, not one query per row.** The criterion
   * says "without needing extra requests", and its reason is that a list screen
   * should cost one round trip — doing it per row would satisfy the words and
   * miss the point, then fall over at fifty customers.
   *
   * `satisfactionScore` is always `null`. It needs ratings, which are US-88 and
   * deferred; a fabricated number would be worse than an honest absence.
   */
  private async statsFor(customerIds: string[]): Promise<Map<string, CustomerStats>> {
    const stats = new Map<string, CustomerStats>();

    for (const id of customerIds) {
      stats.set(id, {
        openTickets: 0,
        totalTickets: 0,
        lastInteractionAt: null,
        satisfactionScore: null,
      });
    }

    if (customerIds.length === 0) {
      return stats;
    }

    const [totals, open] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, deletedAt: null },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: customerIds },
          deletedAt: null,
          status: { not: RESOLVED },
        },
        _count: { _all: true },
      }),
    ]);

    for (const row of totals) {
      const entry = stats.get(row.customerId);

      if (entry !== undefined) {
        entry.totalTickets = row._count._all;
        entry.lastInteractionAt = row._max.updatedAt?.toISOString() ?? null;
      }
    }

    for (const row of open) {
      const entry = stats.get(row.customerId);

      if (entry !== undefined) {
        entry.openTickets = row._count._all;
      }
    }

    return stats;
  }

  private toCustomer(row: CustomerRow, stats: CustomerStats): Customer {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      companyName: row.companyName,
      type: row.type,
      isVip: row.isVip,
      notes: row.notes,
      preferredLocale: row.preferredLocale,
      preferredChannel: row.preferredChannel,
      departmentId: row.departmentId,
      branchId: row.branchId,
      externalRef: row.externalRef,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      stats,
    };
  }

  /**
   * AC3 — every filter reaches the database.
   *
   * Nothing here is applied after fetching. The search is a single `OR` across
   * the four fields an agent actually types into a search box, each of which is
   * indexed.
   */
  private whereFrom(query: CustomerListQuery): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {};

    if (query.q !== undefined && query.q !== '') {
      where.OR = [
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
        { companyName: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    if (query.type !== undefined) {
      where.type = query.type;
    }

    if (query.departmentId !== undefined) {
      where.departmentId = query.departmentId;
    }

    if (query.branchId !== undefined) {
      where.branchId = query.branchId;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.createdFrom !== undefined || query.createdTo !== undefined) {
      where.createdAt = {
        ...(query.createdFrom === undefined ? {} : { gte: new Date(query.createdFrom) }),
        ...(query.createdTo === undefined ? {} : { lte: new Date(query.createdTo) }),
      };
    }

    return where;
  }

  async list(query: CustomerListQuery): Promise<ApiPaginated<Customer>> {
    const where = this.whereFrom(query);
    const { skip, take } = toSkipTake(query);
    const dir = query.dir ?? 'asc';

    // `openTickets` is a derived value and cannot be sorted in this query —
    // see the note in the plan. Falls back to name rather than pretending.
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      query.sort === 'createdAt' ? { createdAt: dir } : { lastName: dir };

    const [rows, total] = await Promise.all([
      this.prisma.notDeleted.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy,
        skip,
        take,
      }),
      this.prisma.notDeleted.customer.count({ where }),
    ]);

    const stats = await this.statsFor(rows.map((row) => row.id));

    return {
      data: rows.map((row) =>
        this.toCustomer(
          row,
          stats.get(row.id) ?? {
            openTickets: 0,
            totalTickets: 0,
            lastInteractionAt: null,
            satisfactionScore: null,
          },
        ),
      ),
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  async byId(id: string): Promise<Customer> {
    const row = await this.prisma.notDeleted.customer.findFirst({
      where: { id },
      select: CUSTOMER_SELECT,
    });

    if (row === null) {
      throw ApiException.notFound('That customer');
    }

    const stats = await this.statsFor([row.id]);

    return this.toCustomer(row, stats.get(row.id)!);
  }

  /**
   * AC2 — a possible duplicate **warns**, it does not block.
   *
   * The refusal carries the existing record so the agent can look at it and
   * decide, rather than being told "duplicate" and left to go and search. A
   * second attempt with `confirmDuplicate` goes through: two people genuinely
   * share a landline, and a desk that cannot record the second one is broken in
   * a way an agent cannot work around.
   */
  async findDuplicate(input: {
    email?: string | undefined;
    phone?: string | undefined;
  }): Promise<DuplicateCustomer | null> {
    for (const [matchedOn, value] of [
      ['email', input.email],
      ['phone', input.phone],
    ] as const) {
      if (value === undefined || value === '') {
        continue;
      }

      const row = await this.prisma.notDeleted.customer.findFirst({
        where: matchedOn === 'email' ? { email: value } : { phone: value },
        select: CUSTOMER_SELECT,
      });

      if (row !== null) {
        const stats = await this.statsFor([row.id]);

        return { matchedOn, existing: this.toCustomer(row, stats.get(row.id)!) };
      }
    }

    return null;
  }

  async create(input: CreateCustomer): Promise<Customer> {
    // The form calls `findDuplicate` on blur and shows the match, so an agent
    // sees it *before* submitting — which is what AC2 is actually about. This
    // check is the backstop: a direct API call cannot bypass the warning, and
    // a second attempt carrying `confirmDuplicate` goes through.
    if (input.confirmDuplicate !== true) {
      const duplicate = await this.findDuplicate(input);

      if (duplicate !== null) {
        throw new ApiException(
          'CONFLICT',
          'A customer with that contact detail already exists. Confirm to add them anyway.',
          [{ path: duplicate.matchedOn, message: duplicate.existing.id }],
        );
      }
    }

    const row = await this.prisma.customer.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        companyName: input.companyName ?? null,
        type: input.type,
        preferredLocale: input.preferredLocale,
        preferredChannel: input.preferredChannel ?? null,
        departmentId: input.departmentId ?? null,
        branchId: input.branchId ?? null,
        externalRef: input.externalRef ?? null,
      },
      select: CUSTOMER_SELECT,
    });

    this.logger.log(`Created customer ${row.id}`);

    return this.toCustomer(row, {
      openTickets: 0,
      totalTickets: 0,
      lastInteractionAt: null,
      satisfactionScore: null,
    });
  }

  async update(id: string, input: UpdateCustomer): Promise<Customer> {
    // Confirms it exists and is not archived before writing, so an update to a
    // soft-deleted row is a 404 rather than a silent resurrection.
    await this.byId(id);

    // Copied key by key rather than passed straight through: with
    // `exactOptionalPropertyTypes`, a property explicitly set to `undefined` is
    // not the same as an absent one, and Prisma reads the two differently on a
    // nullable relation column — `undefined` means "leave alone", `null` means
    // "clear it", and sending the wrong one silently unsets a department.
    const data: Prisma.CustomerUpdateInput = {};

    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      }
    }

    const row = await this.prisma.customer.update({
      where: { id },
      data,
      select: CUSTOMER_SELECT,
    });

    const stats = await this.statsFor([row.id]);

    return this.toCustomer(row, stats.get(row.id)!);
  }

  /**
   * AC5 — archive, never delete.
   *
   * `deletedAt` only. The tickets are deliberately untouched: they are the
   * record of what happened, and a support desk that loses its history when a
   * customer leaves cannot answer a question about last year.
   */
  async archive(id: string): Promise<void> {
    await this.byId(id);

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`Archived customer ${id}`);
  }
}
