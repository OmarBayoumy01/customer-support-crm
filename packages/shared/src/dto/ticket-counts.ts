/**
 * The queue's view tabs — US-42, AC4.
 *
 * One shape, because the tabs and the counts have to agree about what "Breached
 * SLA" means. A tab whose label says one thing and whose count is computed from
 * another is worse than no count at all.
 */
import { z } from 'zod';

/** The six views AC4 names, in the order they appear. */
export const TICKET_VIEWS = [
  'all',
  'unassigned',
  'mine',
  'escalated',
  'breached',
  'closed',
] as const;

export const TicketViewSchema = z.enum(TICKET_VIEWS);
export type TicketView = z.infer<typeof TicketViewSchema>;

export const TicketCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  breached: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
});

export type TicketCounts = z.infer<typeof TicketCountsSchema>;

/**
 * What the sidebar badge subscribes to — US-28, AC5.
 *
 * `atRisk` rather than a plain total, because the number an agent decides what
 * to do next by is *how much of my queue is on fire*, not how big it is.
 */
export const AssignedTicketCountSchema = z.object({
  total: z.number().int().nonnegative(),
  atRisk: z.number().int().nonnegative(),
});

export type AssignedTicketCount = z.infer<typeof AssignedTicketCountSchema>;

/**
 * One dashboard figure, and what it was — US-55, AC1.
 *
 * `previous` is **null when the metric has no honest past value**, which is most
 * of them: the status a week ago is not stored, the breach flags are
 * current-only, and "due soon" is a window relative to now. Reconstructing those
 * needs a daily snapshot, which is P11's analytics work and deliberately not
 * built here.
 *
 * Null rather than zero, so a client renders no indicator instead of claiming a
 * hundred-percent rise from nothing.
 */
export const DashboardMetricSchema = z.object({
  value: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative().nullable(),
});

export type DashboardMetric = z.infer<typeof DashboardMetricSchema>;

/**
 * What an agent holds, the moment they sign in — US-55, AC1.
 *
 * `pending` is a **subset of `open`**, deliberately: one answers "how much do I
 * hold", the other "how much of it is waiting on somebody else". Both are
 * figures an agent acts on differently.
 *
 * Every one of these is derived from the caller's own assigned tickets through
 * `slaFor` — the same function the queue and the ticket header use — rather than
 * from a second definition of the warning window.
 */
export const AssignedSummarySchema = z.object({
  open: DashboardMetricSchema,
  pending: DashboardMetricSchema,
  dueSoon: DashboardMetricSchema,
  breached: DashboardMetricSchema,
});

export type AssignedSummary = z.infer<typeof AssignedSummarySchema>;

/**
 * One slice of a distribution — US-58, AC2.
 *
 * A key, a label the client can read, and a count. Deliberately not a chart
 * series: the scope document's simplification for this story is "no charts
 * library", so the client renders these as labelled bar rows and the shape stays
 * something a table could render just as well.
 */
export const DistributionSliceSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});

export type DistributionSlice = z.infer<typeof DistributionSliceSchema>;

/**
 * The team, as a manager sees it — US-58, AC1 and AC2.
 *
 * Every figure is computed inside the caller's own `ticket:view` scope, in the
 * query. The SLA figures come from `slaFor` — the same function the queue, the
 * ticket header and US-55 use — so there is no dashboard definition of "at risk"
 * or "breached" anywhere.
 *
 * **`customerSatisfaction` is absent, deliberately.** AC1 asks for it and there
 * is nothing to average: no rating column, no endpoint that could set one, and
 * US-88 deferred. A satisfaction figure derived from resolution time or reopen
 * count would be a number whose label lies about what it measures, and a null
 * would be rendered as a zero by somebody eventually. It arrives with US-88.
 */
export const TeamOverviewSchema = z.object({
  /** Not resolved and not closed, inside the caller's scope. */
  open: z.number().int().nonnegative(),
  /** Open and nobody has picked it up — the figure a manager acts on first. */
  unassigned: z.number().int().nonnegative(),
  /** `slaFor(...).state === 'warn'`. */
  atRisk: z.number().int().nonnegative(),
  /** `state === 'breach'`, or a breach flag the sweep has already set. */
  breached: z.number().int().nonnegative(),
  /**
   * Mean seconds from a ticket arriving to the first customer-facing reply.
   *
   * **Null when nothing in the window has been replied to**, rather than zero —
   * "no data" and "instant" are different answers and a zero reads as the second.
   */
  averageResponseSeconds: z.number().int().nonnegative().nullable(),
  /** Mean seconds from arrival to resolution. Null on the same reasoning. */
  averageResolutionSeconds: z.number().int().nonnegative().nullable(),
  /** AC2's five distributions. */
  byStatus: z.array(DistributionSliceSchema),
  byPriority: z.array(DistributionSliceSchema),
  byDepartment: z.array(DistributionSliceSchema),
  byAgent: z.array(DistributionSliceSchema),
  /** One slice per day over the averages' window, oldest first. */
  overTime: z.array(DistributionSliceSchema),
});

export type TeamOverview = z.infer<typeof TeamOverviewSchema>;

/**
 * The two filters AC5 asks for — US-58.
 *
 * **Filters, not scope selectors.** They are `AND`ed with the caller's own ticket
 * scope on the server, so they can only narrow it: a manager asking for another
 * department gets zero, not that department.
 */
export const TeamOverviewQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

export type TeamOverviewQuery = z.infer<typeof TeamOverviewQuerySchema>;
