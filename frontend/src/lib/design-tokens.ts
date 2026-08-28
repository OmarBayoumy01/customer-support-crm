/**
 * The single map from a domain value to how it looks — US-26, AC3.
 *
 * Every screen that renders a status, a priority, or an SLA state resolves it
 * here. That is the whole point: without one map, the ticket list and the
 * ticket header drift apart over six months and nobody notices until a customer
 * asks why "Escalated" is orange in one place and red in another.
 *
 * Two rules these entries encode, both from the definition of done:
 *
 *   1. **Never colour alone.** Every entry carries a `labelKey` and an `icon`.
 *      A badge that renders only a coloured dot is not allowed to exist.
 *   2. **Colour is rationed.** The saturated tokens here are the urgency ramp,
 *      and this file is the only place outside `SlaMeter` that may name them.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Flame,
  Minus,
  PauseCircle,
  type LucideIcon,
} from 'lucide-react';

/** Matches `TicketStatus` in the Prisma schema. */
export const TICKET_STATUSES = [
  'NEW',
  'WAITING_FOR_AGENT',
  'WAITING_FOR_CUSTOMER',
  'RESOLVED',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Matches `TicketPriority` in the Prisma schema. */
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** How far through its SLA target something is. */
export type SlaState = 'ok' | 'warn' | 'breach';

export interface Presentation {
  /** i18n key. Never a literal — the platform is bilingual from day one. */
  labelKey: string;
  icon: LucideIcon;
  /** Tailwind classes. Text plus a soft ground; never a bare colour. */
  className: string;
}

/**
 * Status is **not** on the urgency ramp.
 *
 * A ticket being "Waiting for customer" is not an emergency, and colouring it
 * as one is how a queue becomes unreadable. Status is rendered in the chrome
 * greys, with the icon carrying the distinction. Escalation is now data (the
 * `escalatedAt` column), not a status, so it no longer appears here.
 */
export const STATUS_PRESENTATION: Record<TicketStatus, Presentation> = {
  NEW: {
    labelKey: 'ticket.status.new',
    icon: Circle,
    className: 'text-purple-700 dark:text-purple-400 bg-purple-500/10 border-purple-500/30',
  },
  WAITING_FOR_AGENT: {
    labelKey: 'ticket.status.waitingForAgent',
    icon: CircleDot,
    className: 'text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/30',
  },
  WAITING_FOR_CUSTOMER: {
    labelKey: 'ticket.status.waitingForCustomer',
    icon: PauseCircle,
    className: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  RESOLVED: {
    labelKey: 'ticket.status.resolved',
    icon: CheckCircle2,
    className: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
};

/**
 * Priority urgency colors.
 */
export const PRIORITY_PRESENTATION: Record<TicketPriority, Presentation> = {
  LOW: {
    labelKey: 'ticket.priority.low',
    icon: Minus,
    className: 'text-slate-600 dark:text-slate-400 bg-slate-500/10 border-slate-500/30',
  },
  MEDIUM: {
    labelKey: 'ticket.priority.medium',
    icon: Circle,
    className: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30',
  },
  HIGH: {
    labelKey: 'ticket.priority.high',
    icon: AlertTriangle,
    className: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  URGENT: {
    labelKey: 'ticket.priority.urgent',
    icon: Flame,
    className: 'text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
  },
};

/**
 * How an SLA reads once it is finished with — US-69, AC3.
 *
 * AC3 names four states and `SlaState` has three plus `none`, so this one is a
 * **presentation** state rather than a server one: a response target that was
 * met, or a resolution clock on a ticket that is resolved. Neither is a state of
 * the SLA the server should be asked to compute — both are already facts on the
 * payload — and grey is the signal that the number has stopped mattering.
 *
 * The tokens are the ones `STATUS_PRESENTATION.NEW` uses, rather than a new
 * grey: colour is rationed, and a finished clock is the least urgent thing on
 * the screen.
 */
export const SLA_MET_PRESENTATION: Presentation = {
  labelKey: 'ticket.sla.met',
  icon: CheckCircle2,
  className: 'text-ink-muted bg-secondary border-line',
};

export const SLA_PRESENTATION: Record<SlaState, Presentation> = {
  ok: {
    labelKey: 'ticket.sla.onTrack',
    icon: CheckCircle2,
    className: 'text-sla-ok bg-sla-ok-soft border-sla-ok/25',
  },
  warn: {
    labelKey: 'ticket.sla.dueSoon',
    icon: Clock,
    className: 'text-sla-warn bg-sla-warn-soft border-sla-warn/25',
  },
  breach: {
    labelKey: 'ticket.sla.breached',
    icon: Flame,
    className: 'text-sla-breach bg-sla-breach-soft border-sla-breach/25',
  },
};

/**
 * Where an SLA sits, from the fraction of its target already spent.
 *
 * The thresholds are here rather than at each call site so "due soon" means the
 * same thing on the list, the detail header, and the dashboard. 75% is the
 * point at which an agent can still realistically act; past 100% it has gone.
 */
export function slaStateFor(elapsedFraction: number): SlaState {
  if (elapsedFraction >= 1) {
    return 'breach';
  }

  return elapsedFraction >= 0.75 ? 'warn' : 'ok';
}
