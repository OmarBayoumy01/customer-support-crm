import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AlertCircle, ArrowLeft, Check, LifeBuoy, LoaderCircle, Send } from 'lucide-react';
import type { PortalMessage, PortalTicketDetail, TicketStatus } from '@crm/shared';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { LanguageToggle } from '@/components/language-toggle';
import { cn } from '@/lib/utils';
import { usePortalReply, usePortalRequest } from './use-portal';

/**
 * The three steps AC4 names, and which portal statuses each covers.
 *
 * Derived from the status the payload already carries — no new field, and **no
 * SLA timer to replace**, because the portal contract has never carried one.
 * AC4's second half is satisfied by an absence that already existed.
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
 *
 * The reached steps carry a tick as well as the accent colour: a progress
 * indicator that distinguishes done from pending by hue alone fails the
 * definition of done.
 */
function Progress({ status }: { status: TicketStatus }): React.JSX.Element {
  const { t } = useTranslation();
  const reached = stepIndexFor(status);

  return (
    <ol aria-label={t('portal.request.progress')} className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index <= reached;

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={index === reached ? 'step' : undefined}
              className={cn(
                'text-meta flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                done ? 'border-ink/15 bg-secondary text-ink' : 'border-line text-ink-faint',
              )}
            >
              {done ? <Check aria-hidden="true" className="size-3" /> : null}
              {t(`portal.request.steps.${step}`)}
            </span>

            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="bg-line h-px w-4" />
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
 *
 * Two-sided by alignment: the customer's own on the inline **end**, support's on
 * the inline start. `self-end`/`self-start` and `ms`/`me`, so Arabic mirrors
 * without a single directional class.
 *
 * A support message carries a first name and an avatar and nothing else, which is
 * the most AC3 allows — and the most the payload contains.
 */
function Bubble({ message }: { message: PortalMessage }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const mine = message.author === 'you';

  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(message.createdAt));

  return (
    <li className={cn('flex max-w-[85%] gap-2.5', mine ? 'self-end' : 'self-start')}>
      {mine ? null : (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarFallback className="text-meta">{initialOf(message.authorName)}</AvatarFallback>
        </Avatar>
      )}

      <div>
        <p className="text-meta text-ink-muted mb-1">
          {mine ? t('portal.request.you') : (message.authorName ?? t('portal.request.support'))}
          {' · '}
          <span className="tabular">{when}</span>
        </p>

        <div
          className={cn(
            'rounded-lg border px-3.5 py-2.5',
            mine ? 'bg-secondary border-line' : 'bg-card border-line',
          )}
        >
          <p className="text-body text-ink whitespace-pre-wrap">{message.body}</p>
        </div>
      </div>
    </li>
  );
}

/**
 * A status change, in plain language — AC6.
 *
 * The API sends a **kind**; the sentence is here, in the translations. Nothing
 * about the event names an agent, a field or an internal status — see
 * `PortalEventSchema`.
 */
function EventLine({ kind, at }: { kind: string; at: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <li className="self-center">
      <p className="text-meta text-ink-muted text-center">
        {t(`portal.request.events.${kind}`)}
        {' · '}
        <span className="tabular">
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(at))}
        </span>
      </p>
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

/**
 * One request, read and replied to — US-85.
 *
 * **AC5's attachment button is not here.** Object storage is US-51, deferred, so
 * a button would open a picker that cannot upload — the same call US-86 made
 * about its own form. Flagged in the plan rather than faked.
 *
 * There is no mode switcher and no canned replies, which AC5 forbids: the staff
 * composer's internal-note tab is exactly what must not exist on this screen, and
 * there is no `isInternal` in the request contract for one to toggle.
 */
export function PortalRequestPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const request = usePortalRequest(id);
  const reply = usePortalReply(id);
  const [draft, setDraft] = useState('');

  const send = useCallback(() => {
    if (draft.trim() === '') {
      return;
    }

    reply.mutate(
      { body: draft.trim() },
      {
        // Cleared only once it is delivered. A failed send that wiped the text
        // would lose what the customer wrote.
        onSuccess: () => {
          setDraft('');
        },
      },
    );
  }, [draft, reply]);

  const detail = request.data;

  return (
    <div className="bg-canvas min-h-screen">
      <header className="border-line bg-card border-b">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Link to="/portal" className="flex items-center gap-2.5">
            <LifeBuoy aria-hidden="true" className="text-ink size-5" />
            <span className="text-section font-semibold">{t('portal.home.brand')}</span>
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <Button asChild variant="ghost" size="sm" className="mb-4 gap-2">
          <Link to="/portal">
            {/* `-start` rather than a left arrow flipped by hand. */}
            <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('portal.request.back')}
          </Link>
        </Button>

        {request.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : request.isError || detail === undefined ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-body text-ink">{t('portal.request.notFound')}</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/portal">{t('portal.request.back')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="gap-0 py-0">
              <CardContent className="space-y-4 p-5">
                <div>
                  <p className="tabular text-meta text-ink-muted">
                    {t('portal.requests.number', { number: detail.number })}
                  </p>
                  <h1 className="text-page text-ink mt-0.5 font-semibold">{detail.subject}</h1>
                </div>

                {/* AC4 — the indicator, where a staff header would show clocks. */}
                <Progress status={detail.status} />

                {detail.description === null ? null : (
                  <>
                    <Separator />
                    <p className="text-body text-ink whitespace-pre-wrap">{detail.description}</p>
                  </>
                )}
              </CardContent>
            </Card>

            <section aria-label={t('portal.request.conversation')} className="mt-6">
              <Thread request={detail} />
            </section>

            <Card className="mt-6">
              <CardContent className="p-5">
                {reply.isError ? (
                  <div
                    role="alert"
                    className="border-sla-breach/30 bg-sla-breach-soft text-sla-breach mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5"
                  >
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="text-body">{t('portal.request.replyFailed')}</span>
                  </div>
                ) : null}

                <Label htmlFor="portal-reply" className="mb-1.5">
                  {t('portal.request.replyLabel')}
                </Label>
                <Textarea
                  id="portal-reply"
                  rows={4}
                  className="text-start"
                  placeholder={t('portal.request.replyPlaceholder')}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                  }}
                />

                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    disabled={reply.isPending || draft.trim() === ''}
                    aria-busy={reply.isPending}
                    className="gap-2"
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
