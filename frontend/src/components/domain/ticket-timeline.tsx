/**
 * The ticket audit trail — US-50, AC5.
 *
 * A compact vertical timeline: one hairline rail, one node per event, one line
 * of text each. It sits beside the conversation on the ticket detail screen and
 * is read constantly, so it is deliberately the quietest thing on the page —
 * chrome greys only, no urgency colour. The saturated ramp belongs to SLA and
 * priority; an audit trail is a record, not an alarm.
 *
 * Collapsed by default once a ticket runs long, because reconstructing a
 * dispute (the reason the manager asked for this) starts at the end and works
 * backwards. The first four entries are the ones that answer "what just
 * happened"; everything else is one click away.
 */
import {
  ArrowUpCircle,
  Bot,
  Circle,
  FolderTree,
  Flag,
  Plus,
  RotateCcw,
  Timer,
  UserMinus,
  UserPlus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One entry, matching `TicketHistoryEntrySchema` in `@crm/shared`. */
export interface TicketHistoryEntry {
  id: string;
  eventType: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  /** The person. Null when an automation did it — exactly one of the two. */
  actorName: string | null;
  /** The rule. Null when a person did it — US-50, AC3. */
  automationRule: string | null;
  createdAt: string;
}

/** How many entries a ticket may carry before the panel collapses. */
const COLLAPSE_THRESHOLD = 6;

/** How many stay visible when it does. */
const COLLAPSED_COUNT = 4;

/**
 * The icon for each event.
 *
 * `RESOLVED` is not a `TicketEventType`: resolution arrives as a status change
 * to `RESOLVED`, so the icon is chosen from the value the ticket moved to
 * rather than from the event name.
 */
const EVENT_ICON: Record<string, LucideIcon> = {
  CREATED: Plus,
  STATUS_CHANGED: Circle,
  PRIORITY_CHANGED: Flag,
  ASSIGNED: UserPlus,
  UNASSIGNED: UserMinus,
  CATEGORY_CHANGED: FolderTree,
  DEPARTMENT_CHANGED: FolderTree,
  ESCALATED: ArrowUpCircle,
  SLA_BREACHED: Timer,
  REOPENED: RotateCcw,
  CLOSED: XCircle,
};

function iconFor(entry: TicketHistoryEntry): LucideIcon {
  return EVENT_ICON[entry.eventType] ?? Circle;
}

/**
 * Renders a stored value for a reader.
 *
 * Enum values are translated; anything else — an id, a subject, a tag — is
 * shown as stored. An id is not pretty, but a timeline that silently drops a
 * value it cannot name is worse than one that shows it raw: the manager reading
 * it is trying to establish what actually changed.
 */
function useValueLabel(): (field: string | null, value: string | null) => string | null {
  const { t } = useTranslation();

  return (field, value) => {
    if (value === null || value === '') {
      return null;
    }

    const key =
      field === 'status'
        ? `ticket.status.${camel(value)}`
        : field === 'priority'
          ? `ticket.priority.${camel(value)}`
          : null;

    if (key === null) {
      return value;
    }

    const translated = t(key);

    // i18next echoes the key back when it is missing. Showing `ticket.status.x`
    // to a manager is worse than showing the raw enum.
    return translated === key ? value : translated;
  };
}

/** `PENDING_CUSTOMER` → `pendingCustomer`, matching the i18n keys. */
function camel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Names the field in a sentence: `assigneeId` reads as "Assignee". */
function useFieldLabel(): (field: string | null) => string {
  const { t } = useTranslation();

  return (field) =>
    field === null
      ? t('ticket.history.field.unknown')
      : t(`ticket.history.field.${field}`, { defaultValue: field });
}

/** The exact timestamp — AC2. Never "3 hours ago"; a dispute needs the time. */
function useTimestamp(): (iso: string) => string {
  const { i18n } = useTranslation();

  return (iso) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
}

function Entry({ entry }: { entry: TicketHistoryEntry }): React.JSX.Element {
  const { t } = useTranslation();
  const label = useValueLabel();
  const fieldLabel = useFieldLabel();
  const timestamp = useTimestamp();
  const Icon = iconFor(entry);

  const from = label(entry.field, entry.fromValue);
  const to = label(entry.field, entry.toValue);

  const description =
    entry.eventType === 'CREATED'
      ? t('ticket.history.event.created')
      : to === null
        ? t(`ticket.history.event.${camel(entry.eventType)}`, {
            defaultValue: t('ticket.history.event.changed', { field: entry.field ?? '' }),
          })
        : from === null
          ? t('ticket.history.setTo', { field: fieldLabel(entry.field), value: to })
          : t('ticket.history.movedFromTo', {
              field: fieldLabel(entry.field),
              from,
              to,
            });

  return (
    <li className="relative flex gap-3 py-2">
      {/*
        The node sits on the rail. `-start-*` rather than `-left-*`: in Arabic
        the rail is on the right and the node has to follow it.
      */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-card border-line text-ink-faint relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border',
          entry.automationRule !== null && 'border-dashed',
        )}
      >
        <Icon className="size-3" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">{description}</p>

        <p className="text-meta text-ink-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {entry.automationRule === null ? (
            <span>{entry.actorName ?? t('ticket.history.unknownActor')}</span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Bot aria-hidden="true" className="size-3 shrink-0" />
              {t('ticket.history.automation', { rule: entry.automationRule })}
            </span>
          )}

          <span aria-hidden="true">·</span>

          <time className="font-mono" dateTime={entry.createdAt}>
            {timestamp(entry.createdAt)}
          </time>
        </p>
      </div>
    </li>
  );
}

export interface TicketTimelineProps {
  entries: readonly TicketHistoryEntry[];
  className?: string | undefined;
}

export function TicketTimeline({ entries, className }: TicketTimelineProps): React.JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const collapsible = entries.length > COLLAPSE_THRESHOLD;
  const visible = collapsible && !expanded ? entries.slice(0, COLLAPSED_COUNT) : entries;
  const hidden = entries.length - visible.length;

  if (entries.length === 0) {
    return <p className={cn('text-meta text-ink-muted', className)}>{t('ticket.history.empty')}</p>;
  }

  return (
    <div className={className}>
      <ol className="relative">
        {/*
          The rail. One hairline behind the nodes, inset to their centre, and
          stopped short of the last node so the timeline ends rather than
          trailing off. `border-inline-start` mirrors in Arabic on its own.
        */}
        <span aria-hidden="true" className="border-line absolute inset-y-4 start-3 border-s" />

        {visible.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
      </ol>

      {collapsible && (
        <Button
          variant="ghost"
          size="sm"
          className="text-meta mt-1 ms-9 h-7 px-2"
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded
            ? t('ticket.history.showRecent')
            : t('ticket.history.showAll', { count: hidden })}
        </Button>
      )}
    </div>
  );
}
