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
  ArrowUpCircle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Flame,
  Minus,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/** Matches `TicketStatus` in the Prisma schema. */
export const TICKET_STATUSES = [
  'NEW',
  'OPEN',
  'PENDING_CUSTOMER',
  'PENDING_INTERNAL',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
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
 * A ticket being "Pending customer" is not an emergency, and colouring it as
 * one is how a queue becomes unreadable. Status is rendered in the chrome
 * greys, with the icon carrying the distinction. Only `ESCALATED` borrows from
 * the ramp, because an escalation genuinely is the thing an agent should look
 * at next.
 */
export const STATUS_PRESENTATION: Record<TicketStatus, Presentation> = {
  NEW: {
    labelKey: 'ticket.status.new',
    icon: Circle,
    className: 'text-ink bg-secondary border-line',
  },
  OPEN: {
    labelKey: 'ticket.status.open',
    icon: CircleDot,
    className: 'text-ink bg-secondary border-line',
  },
  PENDING_CUSTOMER: {
    labelKey: 'ticket.status.pendingCustomer',
    icon: PauseCircle,
    className: 'text-ink-muted bg-secondary border-line',
  },
  PENDING_INTERNAL: {
    labelKey: 'ticket.status.pendingInternal',
    icon: Clock,
    className: 'text-ink-muted bg-secondary border-line',
  },
  ESCALATED: {
    labelKey: 'ticket.status.escalated',
    icon: ArrowUpCircle,
    className: 'text-sla-breach bg-sla-breach-soft border-sla-breach/25',
  },
  RESOLVED: {
    labelKey: 'ticket.status.resolved',
    icon: CheckCircle2,
    className: 'text-sla-ok bg-sla-ok-soft border-sla-ok/25',
  },
  CLOSED: {
    labelKey: 'ticket.status.closed',
    icon: XCircle,
    className: 'text-ink-muted bg-transparent border-line',
  },
};

/**
 * Priority **is** on the ramp, because it is a statement about urgency.
 *
 * Low is deliberately colourless. Three of the four priorities being grey is
 * the point — if everything is coloured, nothing is.
 */
export const PRIORITY_PRESENTATION: Record<TicketPriority, Presentation> = {
  LOW: {
    labelKey: 'ticket.priority.low',
    icon: Minus,
    className: 'text-ink-muted bg-transparent border-line',
  },
  MEDIUM: {
    labelKey: 'ticket.priority.medium',
    icon: Circle,
    className: 'text-ink bg-secondary border-line',
  },
  HIGH: {
    labelKey: 'ticket.priority.high',
    icon: AlertTriangle,
    className: 'text-sla-warn bg-sla-warn-soft border-sla-warn/25',
  },
  URGENT: {
    labelKey: 'ticket.priority.urgent',
    icon: Flame,
    className: 'text-sla-breach bg-sla-breach-soft border-sla-breach/25',
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
