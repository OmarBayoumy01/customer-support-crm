import type { SlaTicketFacts } from '@crm/shared';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * Which policies could govern this ticket — US-67, AC2.
 *
 * Every line reads: *this policy does not care, or it agrees with the ticket*.
 * Written as OR pairs so the whole thing stays one indexed query rather than a
 * fetch-then-filter.
 *
 * Lives here, apart from the service, because the demo seeder (US-120) runs
 * outside Nest and has to resolve exactly the same policy the application
 * would. Two copies of "what matches" would drift, and the first symptom would
 * be a demo whose SLA column disagrees with the API.
 */
export function slaCandidateWhere(facts: SlaTicketFacts): Prisma.SlaPolicyWhereInput {
  return {
    isActive: true,
    deletedAt: null,
    AND: [
      { OR: [{ priority: null }, { priority: facts.priority }] },
      { OR: [{ categoryId: null }, { categoryId: facts.categoryId }] },
      { OR: [{ departmentId: null }, { departmentId: facts.departmentId }] },
      { OR: [{ branchId: null }, { branchId: facts.branchId }] },
      { OR: [{ customerType: null }, { customerType: facts.customerType }] },
      { OR: [{ customerIsVip: null }, { customerIsVip: facts.customerIsVip }] },
    ],
  };
}

/** Most specific first; oldest breaks a tie, so resolution is deterministic. */
export const SLA_CANDIDATE_ORDER: Prisma.SlaPolicyOrderByWithRelationInput[] = [
  { specificity: 'desc' },
  { createdAt: 'asc' },
];
