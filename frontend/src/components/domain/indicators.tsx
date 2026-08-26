import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  PRIORITY_PRESENTATION,
  SLA_PRESENTATION,
  slaStateFor,
  STATUS_PRESENTATION,
  type Presentation,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

/**
 * The shared badge shape — US-27, AC2.
 *
 * Built on shadcn's `Badge` rather than a hand-rolled span, so the focus ring,
 * the icon sizing and the truncation behave the way every other badge in the
 * product does. `variant="outline"` because the ground and border come from the
 * domain token — see `design-tokens.ts`, which is the only place allowed to name
 * the urgency ramp.
 *
 * Icon **and** text, always. There is no prop to turn the label off, and that
 * is deliberate: the moment one exists, a dense screen somewhere turns it off
 * to save width and the status becomes a coloured dot that a colour-blind agent
 * cannot read. If width is short, the answer is fewer columns.
 */
function DomainBadge({
  presentation,
  className,
}: {
  presentation: Presentation;
  className?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = presentation.icon;

  return (
    <Badge variant="outline" className={cn('gap-1', presentation.className, className)}>
      <Icon aria-hidden="true" className="shrink-0" />
      {t(presentation.labelKey)}
    </Badge>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string | undefined;
}): React.JSX.Element {
  return <DomainBadge presentation={STATUS_PRESENTATION[status]} className={className} />;
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string | undefined;
}): React.JSX.Element {
  return <DomainBadge presentation={PRIORITY_PRESENTATION[priority]} className={className} />;
}

/** Formats a duration the way an agent reads a countdown: 2h 15m, 45m, 30s. */
export function formatRemaining(seconds: number): string {
  const absolute = Math.abs(Math.round(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);

  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${String(minutes)}m`;
  }

  return `${String(absolute)}s`;
}

export interface SlaProps {
  /** Seconds the target allows in total. */
  targetSeconds: number;
  /** Seconds already spent. May exceed the target — that is a breach. */
  elapsedSeconds: number;
  className?: string | undefined;
}

/**
 * ── The signature element ──────────────────────────────────────────────────
 *
 * The SLA meter: how much of a target is spent, as a bar, a countdown, and a
 * word.
 *
 * This is the one component allowed to be loud, because it is the one thing
 * that matters on a support desk. Everything else in this design system is
 * deliberately quiet so that this reads from across a room.
 *
 * Three redundant encodings, on purpose — the definition of done forbids colour
 * alone, and a countdown is exactly the sort of thing somebody glances at:
 *
 *   1. the **fill** of the bar, which is position and length, not just hue;
 *   2. the **remaining time**, in tabular mono so it does not jitter as it
 *      counts down;
 *   3. the **state in words**, from the shared map.
 *
 * The bar fills from the inline start, so in Arabic it fills from the right —
 * the direction time is read in.
 */
export function SlaMeter({
  targetSeconds,
  elapsedSeconds,
  className,
}: SlaProps): React.JSX.Element {
  const { t } = useTranslation();

  const fraction = targetSeconds <= 0 ? 1 : elapsedSeconds / targetSeconds;
  const state = slaStateFor(fraction);
  const remaining = targetSeconds - elapsedSeconds;
  const presentation = SLA_PRESENTATION[state];

  const fill = {
    ok: 'bg-sla-ok',
    warn: 'bg-sla-warn',
    breach: 'bg-sla-breach',
  }[state];

  const text = {
    ok: 'text-sla-ok',
    warn: 'text-sla-warn',
    breach: 'text-sla-breach',
  }[state];

  const label =
    remaining >= 0
      ? t('ticket.sla.remaining', { time: formatRemaining(remaining) })
      : t('ticket.sla.overBy', { time: formatRemaining(remaining) });

  return (
    <div
      className={cn('flex min-w-32 flex-col gap-1', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(fraction * 100))}
      aria-valuetext={`${t(presentation.labelKey)} — ${label}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('tabular text-meta', text)}>{label}</span>
        <span className="text-meta text-ink-faint">{t(presentation.labelKey)}</span>
      </div>
      <div className="bg-secondary h-1 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', fill)}
          style={{ inlineSize: `${String(Math.min(100, Math.max(2, fraction * 100)))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The same signal, compressed to a rule down the inline-start edge of a row.
 *
 * This is what makes a queue scannable: a hundred rows, and the eye runs down
 * one narrow strip picking out what is burning without reading a word. It is a
 * `border-inline-start`, so in Arabic the strip is on the right, against the
 * same edge the reading starts from — no directional CSS anywhere.
 *
 * Always paired with a real `SlaMeter` or `SlaBadge` in the row. On its own it
 * would be colour alone, which is not allowed.
 */
export function slaEdgeClass(elapsedFraction: number): string {
  return {
    ok: 'border-s-2 border-s-sla-ok/45',
    warn: 'border-s-2 border-s-sla-warn',
    breach: 'border-s-2 border-s-sla-breach',
  }[slaStateFor(elapsedFraction)];
}

export function SlaBadge({
  targetSeconds,
  elapsedSeconds,
  className,
}: SlaProps): React.JSX.Element {
  const fraction = targetSeconds <= 0 ? 1 : elapsedSeconds / targetSeconds;

  return (
    <DomainBadge presentation={SLA_PRESENTATION[slaStateFor(fraction)]} className={className} />
  );
}
