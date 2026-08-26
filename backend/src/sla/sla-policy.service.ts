import { Injectable } from '@nestjs/common';
import type { CreateSlaPolicy, SlaPolicy, SlaTicketFacts, UpdateSlaPolicy } from '@crm/shared';

import { AuditService } from '../audit/index.js';
import { PrismaService } from '../prisma/index.js';
import { SLA_CANDIDATE_ORDER, slaCandidateWhere } from './sla-matching.js';
import { specificityOf } from './sla-specificity.js';
import type { Prisma } from '../generated/prisma/client.js';

/** What the service selects, everywhere, so one shape maps to one DTO. */
const POLICY_SELECT = {
  id: true,
  nameEn: true,
  nameAr: true,
  priority: true,
  categoryId: true,
  departmentId: true,
  branchId: true,
  customerType: true,
  customerIsVip: true,
  specificity: true,
  firstResponseMinutes: true,
  resolutionMinutes: true,
  businessHoursOnly: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  escalationSteps: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      clock: true,
      atPercent: true,
      notify: true,
      notifyUserId: true,
      changeStatusToEscalated: true,
    },
  },
} satisfies Prisma.SlaPolicySelect;

type PolicyRow = Prisma.SlaPolicyGetPayload<{ select: typeof POLICY_SELECT }>;

function toDto(row: PolicyRow): SlaPolicy {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    priority: row.priority,
    categoryId: row.categoryId,
    departmentId: row.departmentId,
    branchId: row.branchId,
    customerType: row.customerType,
    customerIsVip: row.customerIsVip,
    specificity: row.specificity,
    firstResponseMinutes: row.firstResponseMinutes,
    resolutionMinutes: row.resolutionMinutes,
    businessHoursOnly: row.businessHoursOnly,
    isActive: row.isActive,
    escalationSteps: row.escalationSteps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      clock: step.clock,
      atPercent: step.atPercent,
      notify: step.notify,
      notifyUserId: step.notifyUserId,
      changeStatusToEscalated: step.changeStatusToEscalated,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * SLA policies — US-67.
 *
 * No controller by design: the MVP seeds policies rather than managing them in
 * a screen, and US-70 adds the API and UI over this service. Everything here is
 * therefore reachable by the seeder, by US-68's clock, and by US-70 when it
 * arrives.
 */
@Injectable()
export class SlaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The policy governing a ticket — AC2 and AC3.
   *
   * One query. Every candidate is a policy whose every matcher either is NULL
   * ("matches anything") or equals the ticket's own value, ordered by how
   * specific it is. `createdAt` breaks a tie deterministically so that two
   * equally specific policies do not swap between calls — though the unique
   * index added by this story's migration means an exact duplicate cannot exist
   * in the first place.
   *
   * Returns null when nothing matches, and a ticket with no policy simply has
   * no SLA. That is a real state — `SlaStateSchema` has had `none` in it since
   * US-40 — not an error.
   */
  async resolveFor(facts: SlaTicketFacts): Promise<SlaPolicy | null> {
    const row = await this.prisma.slaPolicy.findFirst({
      where: slaCandidateWhere(facts),
      orderBy: SLA_CANDIDATE_ORDER,
      select: POLICY_SELECT,
    });

    return row === null ? null : toDto(row);
  }

  async findById(id: string): Promise<SlaPolicy | null> {
    const row = await this.prisma.slaPolicy.findFirst({
      where: { id, deletedAt: null },
      select: POLICY_SELECT,
    });

    return row === null ? null : toDto(row);
  }

  /** Every policy, most specific first. Used by the seeder and by US-70. */
  async list(): Promise<SlaPolicy[]> {
    const rows = await this.prisma.slaPolicy.findMany({
      where: { deletedAt: null },
      orderBy: [{ specificity: 'desc' }, { createdAt: 'asc' }],
      select: POLICY_SELECT,
    });

    return rows.map(toDto);
  }

  /** AC1 — everything the criterion names, in one row plus its ladder. */
  async create(input: CreateSlaPolicy, actorUserId: string | null): Promise<SlaPolicy> {
    const matchers = {
      priority: input.priority ?? null,
      categoryId: input.categoryId ?? null,
      departmentId: input.departmentId ?? null,
      branchId: input.branchId ?? null,
      customerType: input.customerType ?? null,
      customerIsVip: input.customerIsVip ?? null,
    };

    const row = await this.prisma.slaPolicy.create({
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        ...matchers,
        specificity: specificityOf(matchers),
        firstResponseMinutes: input.firstResponseMinutes,
        resolutionMinutes: input.resolutionMinutes,
        businessHoursOnly: input.businessHoursOnly,
        isActive: input.isActive,
        escalationSteps: {
          create: input.escalationSteps.map((step) => ({
            sequence: step.sequence,
            clock: step.clock,
            atPercent: step.atPercent,
            notify: step.notify,
            notifyUserId: step.notifyUserId ?? null,
            changeStatusToEscalated: step.changeStatusToEscalated,
          })),
        },
      },
      select: POLICY_SELECT,
    });

    const policy = toDto(row);

    await this.audit.record({
      actorUserId,
      action: 'CREATE',
      entityType: 'SlaPolicy',
      entityId: policy.id,
      after: auditableFields(policy),
    });

    return policy;
  }

  /**
   * AC5 — the change is audited with before and after values.
   *
   * AC4 needs no code here and that is the point: `firstResponseDueAt` and
   * `resolutionDueAt` are absolute timestamps written onto the ticket when the
   * policy was applied, so editing the policy cannot move a deadline that has
   * already been set. There is a test that says so, because "it happens not to"
   * and "it cannot" look identical until someone adds a recalculation.
   */
  async update(
    id: string,
    input: UpdateSlaPolicy,
    actorUserId: string | null,
  ): Promise<SlaPolicy | null> {
    const existing = await this.findById(id);

    if (existing === null) {
      return null;
    }

    // A matcher the caller did not mention keeps its current value; one they
    // sent as null is being cleared. `undefined` and `null` mean genuinely
    // different things here, which is why this is written out rather than
    // spread.
    const matchers = {
      priority: input.priority === undefined ? existing.priority : input.priority,
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      departmentId: input.departmentId === undefined ? existing.departmentId : input.departmentId,
      branchId: input.branchId === undefined ? existing.branchId : input.branchId,
      customerType: input.customerType === undefined ? existing.customerType : input.customerType,
      customerIsVip:
        input.customerIsVip === undefined ? existing.customerIsVip : input.customerIsVip,
    };

    const row = await this.prisma.slaPolicy.update({
      where: { id },
      data: {
        ...(input.nameEn === undefined ? {} : { nameEn: input.nameEn }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...matchers,
        specificity: specificityOf(matchers),
        ...(input.firstResponseMinutes === undefined
          ? {}
          : { firstResponseMinutes: input.firstResponseMinutes }),
        ...(input.resolutionMinutes === undefined
          ? {}
          : { resolutionMinutes: input.resolutionMinutes }),
        ...(input.businessHoursOnly === undefined
          ? {}
          : { businessHoursOnly: input.businessHoursOnly }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        // The ladder is replaced wholesale rather than diffed. Rungs are
        // ordered and interdependent — a partial update of three rows that must
        // agree with each other is how you get a policy that escalates twice at
        // 75% and never at 100%.
        ...(input.escalationSteps === undefined
          ? {}
          : {
              escalationSteps: {
                deleteMany: {},
                create: input.escalationSteps.map((step) => ({
                  sequence: step.sequence,
                  clock: step.clock,
                  atPercent: step.atPercent,
                  notify: step.notify,
                  notifyUserId: step.notifyUserId ?? null,
                  changeStatusToEscalated: step.changeStatusToEscalated,
                })),
              },
            }),
      },
      select: POLICY_SELECT,
    });

    const policy = toDto(row);

    await this.audit.recordUpdate({
      actorUserId,
      entityType: 'SlaPolicy',
      entityId: policy.id,
      before: auditableFields(existing),
      after: auditableFields(policy),
    });

    return policy;
  }

  /** Soft delete, so a ticket already governed by it can still name it. */
  async archive(id: string, actorUserId: string | null): Promise<boolean> {
    const existing = await this.findById(id);

    if (existing === null) {
      return false;
    }

    await this.prisma.slaPolicy.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      actorUserId,
      action: 'DELETE',
      entityType: 'SlaPolicy',
      entityId: id,
      before: auditableFields(existing),
    });

    return true;
  }
}

/**
 * What the audit trail records about a policy.
 *
 * Everything except the derived and the housekeeping: `specificity` is computed
 * from the matchers already listed, and timestamps are on the audit row itself.
 */
function auditableFields(policy: SlaPolicy): Record<string, unknown> {
  return {
    nameEn: policy.nameEn,
    nameAr: policy.nameAr,
    priority: policy.priority,
    categoryId: policy.categoryId,
    departmentId: policy.departmentId,
    branchId: policy.branchId,
    customerType: policy.customerType,
    customerIsVip: policy.customerIsVip,
    firstResponseMinutes: policy.firstResponseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
    businessHoursOnly: policy.businessHoursOnly,
    isActive: policy.isActive,
    escalationSteps: policy.escalationSteps.map((step) => ({
      sequence: step.sequence,
      clock: step.clock,
      atPercent: step.atPercent,
      notify: step.notify,
      notifyUserId: step.notifyUserId ?? null,
      changeStatusToEscalated: step.changeStatusToEscalated,
    })),
  };
}
