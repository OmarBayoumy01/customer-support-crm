import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Inbox,
  LifeBuoy,
  LoaderCircle,
  MessageSquare,
  MessageSquareReply,
  Send,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { PortalMessage, PortalTicketDetail, TicketStatus } from '@crm/shared';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { LanguageToggle } from '@/components/language-toggle';
import { DeleteTicketDialog } from '@/components/domain/delete-ticket-dialog';
import { cn } from '@/lib/utils';
import { useDeletePortalTicket, usePortalReply, usePortalRequest } from './use-portal';
import { PortalProfileDialog } from './portal-profile-dialog';

/**
 * The three steps AC4 names, and which portal statuses each covers.
 */
const STEPS = ['received', 'in_progress', 'resolved'] as const;

function stepIndexFor(status: TicketStatus): number {
  if (status === 'RESOLVED') {
    return 2;
  }

  return status === 'NEW' ? 0 : 1;
}

/**
 * Received → In Progress → Resolved — AC4.
 */
function Progress({ status }: { status: TicketStatus }): React.JSX.Element {
  const { t } = useTranslation();
  const reached = stepIndexFor(status);

  return (
    <ol aria-label={t('portal.request.progress')} className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index <= reached;
        const current = index === reached;

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                current
                  ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                  : done
                    ? 'border-muted-foreground/30 bg-muted/60 text-foreground'
                    : 'border-muted text-muted-foreground opacity-60',
              )}
            >
              {done ? (
                <Check aria-hidden="true" className="size-3.5 text-primary" />
              ) : (
                <span className="flex size-3.5 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                  {index + 1}
                </span>
              )}
              {t(`portal.request.steps.${step}`)}
            </span>

            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="bg-border h-px w-4 sm:w-6" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Two letters from a first name, for the support avatar — AC3. */
function initialOf(name: string | null): string {
  return name === null || name === '' ? '?' : name.charAt(0).toUpperCase();
}

/**
 * One message in the thread — AC1 and AC3.
 */
function Bubble({ message }: { message: PortalMessage }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const mine = message.author === 'you';

  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(message.createdAt));

  return (
    <li className={cn('flex max-w-[88%] gap-3', mine ? 'self-end flex-row-reverse' : 'self-start')}>
      <Avatar className="mt-0.5 size-8 shrink-0 border shadow-2xs">
        <AvatarFallback
          className={cn(
            'text-xs font-semibold',
            mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          )}
        >
          {mine ? 'Y' : initialOf(message.authorName)}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
        <p className="mb-1 text-xs text-muted-foreground">
          {mine ? t('portal.request.you') : (message.authorName ?? t('portal.request.support'))}
          {' · '}
          <span className="tabular">{when}</span>
        </p>

        <div
          className={cn(
            'rounded-2xl p-4 shadow-xs transition-colors',
            mine
              ? 'rounded-tr-xs bg-primary text-primary-foreground'
              : 'rounded-tl-xs border bg-card text-card-foreground',
          )}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</p>
        </div>
      </div>
    </li>
  );
}

/**
 * A status change, in plain language — AC6.
 */
function EventLine({ kind, at }: { kind: string; at: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <li className="my-2 self-center">
      <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3.5 py-1 text-xs text-muted-foreground shadow-2xs">
        <Clock aria-hidden="true" className="size-3 text-muted-foreground" />
        <p className="text-center">
          {t(`portal.request.events.${kind}`)}
          {' · '}
          <span className="tabular">
            {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(at))}
          </span>
        </p>
      </div>
    </li>
  );
}

/** The thread and the events, in one time-ordered column. */
function Thread({ request }: { request: PortalTicketDetail }): React.JSX.Element {
  const entries = [
    ...request.messages.map((message) => ({
      at: message.createdAt,
      node: <Bubble key={message.id} message={message} />,
    })),
    ...request.events.map((event) => ({
      at: event.createdAt,
      node: <EventLine key={event.id} kind={event.kind} at={event.createdAt} />,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return <ul className="flex flex-col gap-4">{entries.map((entry) => entry.node)}</ul>;
}

export function PortalRequestPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const request = usePortalRequest(id);
  const reply = usePortalReply(id);
  const deleteTicket = useDeletePortalTicket(id, request.data?.number);
  const [draft, setDraft] = useState('');

  const send = useCallback(() => {
    if (draft.trim() === '') {
      return;
    }

    reply.mutate(
      { body: draft.trim() },
      {
        onSuccess: () => {
          setDraft('');
        },
      },
    );
  }, [draft, reply]);

  const detail = request.data;

  const statusConfig = detail
    ? {
        WAITING_FOR_CUSTOMER: {
          badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          icon: MessageSquareReply,
        },
        WAITING_FOR_AGENT: {
          badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
          icon: Clock,
        },
        RESOLVED: {
          badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          icon: CheckCircle2,
        },
        NEW: {
          badgeClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
          icon: Sparkles,
        },
      }[detail.status] ?? {
        badgeClass: 'border-muted bg-muted text-muted-foreground',
        icon: Inbox,
      }
    : null;

  const StatusIcon = statusConfig?.icon;

  const date = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="bg-background min-h-screen text-foreground">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-3.5">
          <Link to="/portal" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <LifeBuoy aria-hidden="true" className="size-5" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-foreground">
                {t('portal.home.brand')}
              </span>
              <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                Portal
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <PortalProfileDialog />
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Back Link & Top Actions */}
        <div className="mb-6 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <Link to="/portal">
              <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
              {t('portal.request.back')}
            </Link>
          </Button>

          {detail && detail.status !== 'RESOLVED' ? (
            <DeleteTicketDialog
              ticketNumber={detail.number}
              isDeleting={deleteTicket.isPending}
              onConfirm={async () => {
                await deleteTicket.mutateAsync();
              }}
            />
          ) : null}
        </div>

        {request.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        ) : request.isError || detail === undefined ? (
          <Card className="rounded-2xl border">
            <CardContent className="p-8 text-center">
              <p className="text-sm font-medium text-foreground">{t('portal.request.notFound')}</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/portal">{t('portal.request.back')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Ticket Header Card */}
            <Card className="overflow-hidden rounded-2xl border bg-card shadow-xs">
              <CardContent className="p-6 sm:p-7 space-y-6">
                {/* Meta Top: Ticket number, category pill & status */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-muted text-muted-foreground">
                      {t('portal.requests.number', { number: detail.number })}
                    </span>

                    <Badge variant="outline" className="gap-1 font-normal text-xs text-muted-foreground">
                      <Tag aria-hidden="true" className="size-3" />
                      {detail.categoryName ?? t('portal.requests.noCategory')}
                    </Badge>
                  </div>

                  {statusConfig && StatusIcon ? (
                    <Badge variant="outline" className={cn('gap-1.5 py-1 text-xs font-medium', statusConfig.badgeClass)}>
                      <StatusIcon aria-hidden="true" className="size-3.5" />
                      {t(`portal.requests.status.${detail.status}`)}
                    </Badge>
                  ) : null}
                </div>

                {/* Subject Title */}
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                    {detail.subject}
                  </h1>
                </div>

                {/* Stepper Progress */}
                <div className="rounded-xl bg-muted/30 p-3.5 border">
                  <Progress status={detail.status} />
                </div>

                {/* Description Body */}
                {detail.description === null ? null : (
                  <div className="space-y-2">
                    <Separator />
                    <div className="pt-2 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {detail.description}
                    </div>
                  </div>
                )}

                {/* Footer Metadata */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t pt-4">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays aria-hidden="true" className="size-3.5" />
                    {t('portal.requests.openedOn', { date: date(detail.createdAt) })}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <Clock aria-hidden="true" className="size-3.5" />
                    {t('portal.requests.updatedOn', { date: date(detail.updatedAt) })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Conversation Thread */}
            <section aria-label={t('portal.request.conversation')} className="mt-8">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t('portal.request.conversation')}
                </h2>
              </div>
              <Thread request={detail} />
            </section>

            {/* Reply Composer Card */}
            <Card className="mt-8 rounded-2xl border bg-card shadow-xs">
              <CardContent className="p-6">
                {reply.isError ? (
                  <div
                    role="alert"
                    className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs"
                  >
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="font-medium">{t('portal.request.replyFailed')}</span>
                  </div>
                ) : null}

                <Label htmlFor="portal-reply" className="mb-2 block text-xs font-semibold text-foreground">
                  {t('portal.request.replyLabel')}
                </Label>
                <Textarea
                  id="portal-reply"
                  rows={4}
                  className="min-h-[110px] resize-y placeholder:text-muted-foreground"
                  placeholder={t('portal.request.replyPlaceholder')}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                  }}
                />

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Press send to submit your reply
                  </span>
                  <Button
                    type="button"
                    disabled={reply.isPending || draft.trim() === ''}
                    aria-busy={reply.isPending}
                    className="gap-2 shadow-xs"
                    onClick={send}
                  >
                    {reply.isPending ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Send aria-hidden="true" className="size-4" />
                    )}
                    {reply.isPending ? t('portal.request.sending') : t('portal.request.send')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

