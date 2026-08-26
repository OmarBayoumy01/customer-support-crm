import { Building2, ExternalLink, Mail, Phone, Star, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Customer, Ticket } from '@crm/shared';

import { StatusBadge } from '@/components/domain/indicators';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <section className="p-4">
        <h3 className="text-meta text-ink-muted mb-2 font-medium tracking-wide uppercase">
          {title}
        </h3>
        {children}
      </section>
      <Separator className="last:hidden" />
    </>
  );
}

export interface CustomerContextPanelProps {
  customer: Customer | undefined;
  isLoading: boolean;
  recentTickets: Ticket[] | undefined;
  className?: string | undefined;
}

/**
 * Who you are talking to — US-45, AC4.
 *
 * The panel exists so an agent never has to leave the ticket to find out
 * whether this is the third time someone has called about the same thing. That
 * is the whole argument for the three-column layout: navigating away to check
 * loses the reply you were half-way through writing.
 *
 * Ordered by what you need before you type: who they are, how to reach them,
 * what standing they have, what else is open, and anything a colleague thought
 * worth writing down.
 */
export function CustomerContextPanel({
  customer,
  isLoading,
  recentTickets,
  className,
}: CustomerContextPanelProps): React.JSX.Element {
  const { t } = useTranslation();

  if (isLoading || customer === undefined) {
    return (
      <div className={cn('space-y-3 p-4', className)}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const Icon = customer.type === 'COMPANY' ? Building2 : UserRound;
  const displayName = `${customer.firstName} ${customer.lastName}`;

  return (
    <div className={className}>
      <Section title={t('ticket.detail.context.customer')}>
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9">
              <AvatarFallback className="text-meta">
                {/*
                  Initials, not a photograph. The platform has no avatar
                  uploads, and a generic silhouette on every row says nothing —
                  two letters at least distinguish one person from another.
                */}
                {initials(customer.firstName, customer.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-body text-ink font-medium">{displayName}</p>
              {customer.companyName !== null && (
                <p className="text-meta text-ink-muted flex items-center gap-1">
                  <Icon aria-hidden="true" className="size-3 shrink-0" />
                  {customer.companyName}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {customer.isVip && (
              // Text plus icon, like every other status on this platform.
              <Badge
                variant="outline"
                className="text-sla-warn bg-sla-warn-soft border-sla-warn/25"
              >
                <Star aria-hidden="true" />
                {t('ticket.detail.context.vip')}
              </Badge>
            )}
            {!customer.isActive && (
              <Badge variant="outline" className="text-ink-muted font-normal">
                {t('ticket.detail.context.inactive')}
              </Badge>
            )}
          </div>

          <dl className="text-meta space-y-1">
            {customer.email !== null && (
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('ticket.detail.context.email')}</dt>
                <Mail aria-hidden="true" className="text-ink-faint size-3.5 shrink-0" />
                <dd className="min-w-0 truncate">
                  <a className="text-accent hover:underline" href={`mailto:${customer.email}`}>
                    {customer.email}
                  </a>
                </dd>
              </div>
            )}
            {customer.phone !== null && (
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('ticket.detail.context.phone')}</dt>
                <Phone aria-hidden="true" className="text-ink-faint size-3.5 shrink-0" />
                <dd className="tabular">
                  <a className="text-accent hover:underline" href={`tel:${customer.phone}`}>
                    {customer.phone}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <Link
            to={`/customers/${customer.id}`}
            className="text-meta text-accent inline-flex items-center gap-1 hover:underline"
          >
            {t('ticket.detail.context.fullProfile')}
            <ExternalLink aria-hidden="true" className="size-3" />
          </Link>
        </div>
      </Section>

      <Section title={t('ticket.detail.context.history')}>
        <dl className="text-meta grid grid-cols-2 gap-2">
          <div>
            <dt className="text-ink-muted">{t('ticket.detail.context.openTickets')}</dt>
            <dd className="tabular text-body text-ink">{customer.stats.openTickets}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t('ticket.detail.context.totalTickets')}</dt>
            <dd className="tabular text-body text-ink">{customer.stats.totalTickets}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t('ticket.detail.context.recentTickets')}>
        {recentTickets === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : recentTickets.length === 0 ? (
          <p className="text-meta text-ink-muted">{t('ticket.detail.context.noOtherTickets')}</p>
        ) : (
          <ul className="space-y-2">
            {recentTickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="hover:bg-secondary/60 -mx-1 block rounded px-1 py-0.5"
                >
                  <p className="text-meta text-ink line-clamp-1">{ticket.subject}</p>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="tabular text-meta text-ink-faint">#{ticket.number}</span>
                    <StatusBadge status={ticket.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('ticket.detail.context.notes')}>
        {customer.notes === null || customer.notes === '' ? (
          <p className="text-meta text-ink-muted">{t('ticket.detail.context.noNotes')}</p>
        ) : (
          <p className="text-meta text-ink whitespace-pre-line">{customer.notes}</p>
        )}
      </Section>
    </div>
  );
}

/** Two letters, uppercased. Enough to tell one person from another at a glance. */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
