/**
 * How much each matcher is worth — US-67, AC2 and AC3.
 *
 * "The most specific matching policy wins" needs a definition of specific, and
 * counting matchers is the obvious one that gets AC3 wrong: a VIP policy sets a
 * single field where a general policy might set three, so counting would let
 * the general policy beat it. VIP therefore outweighs everything below it
 * combined.
 *
 * The values double so that the set of matchers behaves as a bit field — a
 * strictly larger set always outranks a smaller one, and no two combinations
 * tie by accident. `customerType` shares `branchId`'s weight deliberately:
 * individual-versus-company is the coarsest of the six dimensions.
 *
 * Kept free of Nest so the seeder, which runs outside the application, can
 * compute the same number the service does rather than hard-coding it.
 */
export const SLA_MATCHER_WEIGHTS = {
  customerIsVip: 16,
  priority: 8,
  categoryId: 4,
  departmentId: 2,
  branchId: 1,
  customerType: 1,
} as const;

export type SlaMatcherField = keyof typeof SLA_MATCHER_WEIGHTS;

const MATCHER_FIELDS = Object.keys(SLA_MATCHER_WEIGHTS) as SlaMatcherField[];

/** AC2 — how specific a policy is, as one number the resolver can order by. */
export function specificityOf(matchers: Partial<Record<SlaMatcherField, unknown>>): number {
  return MATCHER_FIELDS.reduce(
    (total, field) =>
      matchers[field] === null || matchers[field] === undefined
        ? total
        : total + SLA_MATCHER_WEIGHTS[field],
    0,
  );
}
