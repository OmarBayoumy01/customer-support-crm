import { DEFAULT_SLA_POLICIES } from './default-policies.js';
import { specificityOf } from './sla-specificity.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * The SLA policies a fresh installation starts with — US-67.
 *
 * Idempotent, but there is no natural key to upsert on: the identity of a policy
 * *is* its set of matchers, and the unique index enforcing that uses
 * `NULLS NOT DISTINCT`, which Prisma has no schema syntax for and so cannot
 * target with `upsert`. So: look it up by its matchers, update if found, create
 * if not.
 *
 * The ladder is replaced wholesale on update for the same reason
 * `SlaPolicyService.update` does it — rungs are ordered and interdependent, and
 * a half-updated ladder is worse than either version of it.
 *
 * Lives beside the policies rather than in `seed/` because US-120's demo seeder
 * needs it too: a demo ticket with no policy has no deadline, and a demo with no
 * SLA column is not a demo of this product.
 */
export async function seedDefaultSlaPolicies(prisma: PrismaClient): Promise<number> {
  for (const policy of DEFAULT_SLA_POLICIES) {
    const matchers = {
      priority: policy.priority ?? null,
      categoryId: policy.categoryId ?? null,
      departmentId: policy.departmentId ?? null,
      branchId: policy.branchId ?? null,
      customerType: policy.customerType ?? null,
      customerIsVip: policy.customerIsVip ?? null,
    };

    const steps = policy.escalationSteps.map((step) => ({
      sequence: step.sequence,
      clock: step.clock,
      atPercent: step.atPercent,
      notify: step.notify,
      notifyUserId: step.notifyUserId ?? null,
      changeStatusToEscalated: step.changeStatusToEscalated,
    }));

    const existing = await prisma.slaPolicy.findFirst({
      where: { ...matchers, deletedAt: null },
      select: { id: true },
    });

    const data = {
      nameEn: policy.nameEn,
      nameAr: policy.nameAr,
      ...matchers,
      specificity: specificityOf(matchers),
      firstResponseMinutes: policy.firstResponseMinutes,
      resolutionMinutes: policy.resolutionMinutes,
      businessHoursOnly: policy.businessHoursOnly,
      isActive: policy.isActive,
    };

    if (existing === null) {
      await prisma.slaPolicy.create({ data: { ...data, escalationSteps: { create: steps } } });
    } else {
      await prisma.slaPolicy.update({
        where: { id: existing.id },
        data: { ...data, escalationSteps: { deleteMany: {}, create: steps } },
      });
    }
  }

  return DEFAULT_SLA_POLICIES.length;
}
