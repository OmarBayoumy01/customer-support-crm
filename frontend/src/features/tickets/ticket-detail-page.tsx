import { useAtom } from 'jotai';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { ticketContextCollapsedAtom } from '@/app/shell-state';
import { TicketTimeline } from '@/components/domain/ticket-timeline';
import { ErrorState } from '@/components/states/error-state';
import { DetailSkeleton } from '@/components/states/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CustomerContextPanel } from './customer-context-panel';
import { TicketComposer } from './ticket-composer';
import { TicketConversation } from './ticket-conversation';
import { TicketHeader } from './ticket-header';
import {
  useCustomer,
  useCustomerTickets,
  useEarlierMessages,
  useTicketDetail,
} from './use-ticket-detail';

/**
 * The ticket workspace — US-45. The visual centrepiece of the product.
 *
 * Three columns on a desktop, and the argument for each is the same: **an agent
 * should never have to leave this page to answer a question about this ticket.**
 * Navigating away to check whether the customer has called before loses the
 * reply you were half-way through writing, and that is how a five-minute ticket
 * becomes a twenty-minute one.
 *
 * - **Centre** — the conversation, which is what the agent is actually reading,
 *   and the composer docked at its foot (US-1 fills the dock).
 * - **End side** — customer context and the ticket's own history, collapsible
 *   so the conversation can take the whole width when somebody is reading a
 *   long thread.
 * - **Above both** — the header, carrying everything AC6 says must never be
 *   behind a dialog.
 *
 * On tablet and mobile the columns stack: the header, then the conversation,
 * then the context. The context panel is last because it is the part you read
 * once, not the part you scroll.
 */
export function TicketDetailPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [collapsed, setCollapsed] = useAtom(ticketContextCollapsedAtom);

  const detail = useTicketDetail(id);
  const earlier = useEarlierMessages(id, detail.data?.messages.length ?? 30);
  const customerId = detail.data?.customer.id;
  const customer = useCustomer(customerId);
  const recent = useCustomerTickets(customerId, id);

  if (detail.isPending) {
    return <DetailSkeleton />;
  }

  if (detail.error !== null) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const ticket = detail.data;

  /**
   * The whole thread the reader has asked for, oldest first.
   *
   * Each earlier page arrives newest-first (it is a backwards page), so the
   * pages are reversed and prepended: page 2 sits above page 1, and page 3
   * above that.
   */
  const thread = [
    ...(earlier.data?.pages ?? [])
      .slice()
      .reverse()
      .flatMap((page) => [...page].reverse()),
    ...ticket.messages,
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <TicketHeader ticket={ticket} />

      <div
        className={cn(
          'grid gap-5 items-start',
          collapsed ? 'grid-cols-[1fr_auto]' : 'grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        {/* The conversation and its composer dock */}
        <Card
          role="region"
          aria-label={t('ticket.detail.conversation.title')}
          className="flex flex-col h-[calc(100vh-14rem)] min-h-[32rem] gap-0 overflow-hidden rounded-xl border bg-card/80 p-0 shadow-xs"
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
            <TicketConversation
              messages={thread}
              description={ticket.description}
              createdAt={ticket.createdAt}
              customerName={`${ticket.customer.firstName} ${ticket.customer.lastName}`}
              messageCount={ticket.messageCount}
              onLoadEarlier={() => {
                void earlier.fetchNextPage();
              }}
              isLoadingEarlier={earlier.isFetching}
            />
          </div>

          {/* Composer Dock */}
          <div className="shrink-0">
            <TicketComposer ticketId={ticket.id} isResolved={ticket.status === 'RESOLVED'} />
          </div>
        </Card>

        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label={t('ticket.detail.context.expand')}
            className="flex flex-col items-center justify-start gap-4 rounded-xl border bg-card/80 py-4 px-2 hover:bg-muted/40 transition-colors h-[calc(100vh-14rem)] min-h-[32rem] shadow-xs group cursor-pointer"
          >
            <div className="flex size-7 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground group-hover:text-foreground group-hover:border-primary/40 shadow-2xs">
              <PanelRightOpen aria-hidden="true" className="size-4 rtl:rotate-180" />
            </div>
            <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
              {t('ticket.detail.context.title')}
            </span>
          </button>
        ) : (
          <Card
            role="complementary"
            aria-label={t('ticket.detail.context.title')}
            className="h-fit gap-0 overflow-hidden rounded-xl border bg-card/80 p-0 shadow-xs"
          >
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <h2 className="text-sm font-semibold text-foreground">
                {t('ticket.detail.context.title')}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground -me-1"
                onClick={() => {
                  setCollapsed(true);
                }}
                aria-label={t('ticket.detail.context.collapse')}
              >
                <PanelRightClose aria-hidden="true" className="size-4 rtl:rotate-180" />
              </Button>
            </div>

            <CardContent className="p-0">
              <CustomerContextPanel
                customer={customer.data}
                isLoading={customer.isPending}
                recentTickets={recent.data}
              />

              <section className="p-5 border-t">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {t('ticket.history.title')}
                </h3>
                <TicketTimeline entries={ticket.history} />
              </section>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
