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
