import { ChevronDown, Clock, Timer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useNow } from '@/hooks/use-now';
import {
  SLA_MET_PRESENTATION,
  SLA_PRESENTATION,
  slaStateFor,
  type Presentation,
  type SlaState,
} from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { formatRemaining } from './indicators';

/** Which of a ticket's two commitments this timer is showing. */
export type SlaKind = 'response' | 'resolution';

/**
 * How a timer reads — US-69, AC3.
 *
 * `SlaState` (the design-token union: ok / warn / breach) plus the fourth state
 * AC3 names, plus `none` for a ticket no policy governs. `met` is derived in the client
 * from facts the payload already carries, rather than added to the shared enum:
 * a response is met when it was sent, and a resolution clock is met when the
 * ticket is resolved. Neither is a state of the SLA itself.
 */
export type SlaDisplayState = SlaState | 'met' | 'none';

export interface SlaTimerProps {
  kind: SlaKind;
  /** The deadline. Null when no policy applies. */
  dueAt: string | null;
  /** Already recorded as breached by the sweep, whatever the arithmetic says. */
  breached: boolean;
  /** True once this particular commitment is finished with — AC3's grey. */
  met: boolean;
  /** When the ticket's clock started, so a fraction can be taken of it. */
  startedAt: string;
  policyName: string | null;
  targetMinutes: number | null;
  /** Stopped since — non-null while the ticket waits on the customer. */
  pausedAt: string | null;
  /** Stopped for, in total. */
  pausedMs: number;
  className?: string | undefined;
}

/**
 * Which display state a timer is in, given a clock.
 *
 * Pure, and `now` is a parameter rather than a `Date.now()` read inside — the
 * whole point is that this is testable against a fixed clock, and US-68 made the
 * same choice on the server for the same reason.
 */
export function slaDisplayState(input: {
  dueAt: string | null;
  breached: boolean;
  met: boolean;
  startedAt: string;
  now: Date;
}): SlaDisplayState {
  if (input.met) {
    // Checked first: a target that was met stays met even once its deadline is
    // in the past, which is exactly the case a running countdown gets wrong.
    return 'met';
  }

  if (input.dueAt === null) {
    return 'none';
  }

  if (input.breached) {
    return 'breach';
  }

  const due = Date.parse(input.dueAt);
  const started = Date.parse(input.startedAt);
  const total = due - started;

  if (total <= 0) {
    return 'breach';
  }

  return slaStateFor((input.now.getTime() - started) / total);
}

/** The presentation for a display state, `none` included. */
function presentationFor(state: SlaDisplayState): Presentation | null {
  if (state === 'met') {
    return SLA_MET_PRESENTATION;
  }

  return state === 'none' ? null : SLA_PRESENTATION[state];
}

/**
 * One SLA commitment, as a sentence — US-69.
 *
 * Replaces the private clock US-45 built inside the ticket header. It lives here
 * with the other domain indicators because AC6 is a rule about every surface at
 * once, and a timer that exists only inside one screen is what AC6 is written to
 * prevent.
 *
 * Four things the header's version did not do: it names the completed state in
 * grey (AC3), it ticks (AC5), it reads as a sentence rather than a heading above
 * a bare figure (AC2), and it can show the target and the time the clock spent
 * stopped (AC4).
 */
export function SlaTimer({
  kind,
  dueAt,
  breached,
  met,
  startedAt,
  policyName,
  targetMinutes,
  pausedAt,
  pausedMs,
  className,
}: SlaTimerProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  // AC5 — the tick. Everything below is a function of this and the props, so the
  // state and the number move together as thresholds are crossed.
  const now = useNow(1000);

  const Icon = kind === 'response' ? Timer : Clock;
  const label = t(`ticket.sla.timer.${kind}`);
  const state = slaDisplayState({ dueAt, breached, met, startedAt, now });
  const presentation = presentationFor(state);

  const colour = {
    ok: 'text-sla-ok',
    warn: 'text-sla-warn',
    breach: 'text-sla-breach',
    met: 'text-ink-muted',
    none: 'text-ink-faint',
  }[state];

  /** AC2 — the label and the number are one sentence, not two lines. */
  const sentence = (): string => {
    if (state === 'met') {
      return t('ticket.sla.timer.met', { label });
    }

    if (dueAt === null) {
      return t('ticket.sla.timer.none', { label });
    }

    const remainingSeconds = Math.round((Date.parse(dueAt) - now.getTime()) / 1000);

    return remainingSeconds >= 0
      ? t('ticket.sla.timer.dueIn', { label, time: formatRemaining(remainingSeconds) })
      : t('ticket.sla.timer.overdueBy', { label, time: formatRemaining(remainingSeconds) });
  };

  const timestamp = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  const details: { term: string; value: string }[] = [];

  if (targetMinutes !== null) {
    details.push({
      term: t('ticket.detail.sla.target'),
      value: formatRemaining(targetMinutes * 60),
    });
  }

  if (dueAt !== null) {
    details.push({ term: t('ticket.detail.sla.dueAt'), value: timestamp(dueAt) });
  }

  details.push({
    term: t('ticket.detail.sla.policy'),
    value: policyName ?? t('ticket.detail.sla.noPolicy'),
  });

  /**
   * AC4's "any paused periods".
   *
   * The schema banks a total rather than a list of intervals, so that is what is
   * shown, plus whether the clock is stopped right now — which is the half an
   * agent acts on.
   */
  if (pausedAt !== null) {
    details.push({
      term: t('ticket.detail.sla.paused'),
      value: t('ticket.detail.sla.pausedSince', { time: timestamp(pausedAt) }),
    });
  } else if (pausedMs > 0) {
    details.push({
      term: t('ticket.detail.sla.paused'),
      value: formatRemaining(Math.round(pausedMs / 1000)),
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('min-w-44', className)}>
      {/*
        The visible text is the state; the accessible name carries which clock it
        belongs to as well. Two triggers both announcing "Breached" would be two
        buttons a screen reader cannot tell apart.
      */}
      <CollapsibleTrigger
        aria-label={presentation === null ? label : `${label} — ${t(presentation.labelKey)}`}
        className="focus-visible:ring-ring -mx-1 flex items-center gap-1.5 rounded px-1 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Icon aria-hidden="true" className="text-ink-faint size-3.5" />
        {/* AC3 — the state in words beside the colour, never the colour alone. */}
        <span className="text-meta text-ink-muted">
          {presentation === null ? label : t(presentation.labelKey)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('text-ink-faint size-3 transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>

      <p className={cn('tabular text-body font-medium', colour)}>{sentence()}</p>

      <CollapsibleContent>
        <dl className="text-meta text-ink-muted mt-1 space-y-0.5">
          {details.map((detail) => (
            <div key={detail.term} className="flex gap-1">
              <dt>{detail.term}</dt>
              <dd
                className={cn(
                  'text-ink',
                  detail.term === t('ticket.detail.sla.dueAt') && 'tabular',
                )}
              >
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
