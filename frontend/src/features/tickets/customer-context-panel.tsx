import { Building2, ExternalLink, Mail, Phone, Star, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Customer, Ticket } from '@crm/shared';

import { StatusBadge } from '@/components/domain/indicators';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-context';
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
      <section className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
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
  const { permissions } = useAuth();

  const isManager =
    permissions?.roles.includes('manager') ||
    permissions?.roles.includes('administrator');

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
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 border border-primary/20 bg-primary/10 text-primary">
              <AvatarFallback className="font-semibold text-xs">
                {initials(customer.firstName, customer.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
              {customer.companyName !== null && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Icon aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{customer.companyName}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {customer.isVip && (
              <Badge
                variant="outline"
                className="gap-1 text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30 font-medium text-xs"
              >
                <Star aria-hidden="true" className="size-3 fill-amber-500 text-amber-500" />
                {t('ticket.detail.context.vip')}
              </Badge>
            )}
            {!customer.isActive && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {t('ticket.detail.context.inactive')}
              </Badge>
            )}
          </div>

          <dl className="space-y-1.5 text-xs">
            {customer.email !== null && (
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('ticket.detail.context.email')}</dt>
                <Mail aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                <dd className="min-w-0 truncate">
                  <a className="text-primary hover:underline" href={`mailto:${customer.email}`}>
                    {customer.email}
                  </a>
                </dd>
              </div>
            )}
            {customer.phone !== null && (
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('ticket.detail.context.phone')}</dt>
                <Phone aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                <dd className="font-mono">
                  <a className="text-primary hover:underline" href={`tel:${customer.phone}`}>
                    {customer.phone}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {isManager && (
            <Button asChild variant="outline" size="sm" className="w-full text-xs gap-1.5 shadow-2xs mt-1">
              <Link to={`/customers/${customer.id}`}>
                <span>{t('ticket.detail.context.fullProfile')}</span>
                <ExternalLink aria-hidden="true" className="size-3 rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </div>
      </Section>

      <Section title={t('ticket.detail.context.history')}>
        <dl className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border bg-muted/40 p-3">
            <dt className="text-xs font-medium text-muted-foreground">{t('ticket.detail.context.openTickets')}</dt>
            <dd className="tabular font-mono text-xl font-bold text-foreground mt-1">{customer.stats.openTickets}</dd>
          </div>
          <div className="rounded-xl border bg-muted/40 p-3">
            <dt className="text-xs font-medium text-muted-foreground">{t('ticket.detail.context.totalTickets')}</dt>
            <dd className="tabular font-mono text-xl font-bold text-foreground mt-1">{customer.stats.totalTickets}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t('ticket.detail.context.recentTickets')}>
        {recentTickets === undefined ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : recentTickets.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('ticket.detail.context.noOtherTickets')}</p>
        ) : (
          <ul className="space-y-2">
            {recentTickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="group block rounded-xl border bg-card/60 p-2.5 shadow-2xs hover:bg-muted/60 transition-colors"
                >
                  <p className="text-xs font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">{ticket.subject}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">#{ticket.number}</span>
                    <StatusBadge status={ticket.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('ticket.detail.context.notes')}>
        {customer.notes === null || customer.notes === '' ? (
          <p className="text-xs text-muted-foreground">{t('ticket.detail.context.noNotes')}</p>
        ) : (
          <div className="rounded-xl border border-muted-foreground/20 bg-muted/30 p-3 text-xs text-foreground whitespace-pre-line leading-relaxed">
            {customer.notes}
          </div>
        )}
      </Section>
    </div>
  );
}

/** Two letters, uppercased. Enough to tell one person from another at a glance. */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
