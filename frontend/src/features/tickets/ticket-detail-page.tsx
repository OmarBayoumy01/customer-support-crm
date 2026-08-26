import { useAtom } from 'jotai';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { ticketContextCollapsedAtom } from '@/app/shell-state';
import { TicketTimeline } from '@/components/domain/ticket-timeline';
import { ErrorState } from '@/components/states/error-state';
import { DetailSkeleton } from '@/components/states/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
    <div className="space-y-4">
      <TicketHeader ticket={ticket} />

      <div
        className={cn(
          'grid gap-4',
          // The context column is a fixed, readable width; the conversation
          // takes whatever is left, which is what AC5's "expands to use the
          // space" means in practice.
          collapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_20rem]',
        )}
      >
        {/*
          The conversation and its composer dock. `flex` with the thread
          scrolling means the composer stays at the foot of the column rather
          than at the foot of the page, which is AC3's actual requirement.
        */}
        {/*
          `role` rather than a <section> element: shadcn's Card is a div and has
          no `asChild`, and a labelled region is the same landmark to a screen
          reader either way.
        */}
        <Card
          role="region"
          aria-label={t('ticket.detail.conversation.title')}
          className="min-h-[32rem] gap-0 overflow-hidden py-0 lg:max-h-[calc(100vh-20rem)]"
        >
          <ScrollArea className="flex-1">
            <div className="p-4">
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
          </ScrollArea>

          {/*
            The dock. Empty until US-1, which owns replying and adding an
            internal note. It is a real region rather than nothing, because AC3
            is about where the composer sits and a layout that only becomes
            correct three stories later is a layout nobody has seen.
          */}
          {/* US-1 fills the dock US-45 reserved. */}
          <TicketComposer ticketId={ticket.id} />
        </Card>

        {!collapsed && (
          <Card
            role="complementary"
            aria-label={t('ticket.detail.context.title')}
            className="h-fit gap-0 overflow-hidden py-0"
          >
            <CardHeader className="flex-row items-center justify-between gap-2 px-4 py-2">
              <CardTitle className="text-meta text-ink">
                {t('ticket.detail.context.title')}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setCollapsed(true);
                }}
                aria-label={t('ticket.detail.context.collapse')}
              >
                <PanelRightClose aria-hidden="true" className="rtl:rotate-180" />
              </Button>
            </CardHeader>

            <Separator />

            <CardContent className="p-0">
              <CustomerContextPanel
                customer={customer.data}
                isLoading={customer.isPending}
                recentTickets={recent.data}
              />

              <section className="p-4">
                <h3 className="text-meta text-ink-muted mb-2 font-medium tracking-wide uppercase">
                  {t('ticket.history.title')}
                </h3>
                <TicketTimeline entries={ticket.history} />
              </section>
            </CardContent>
          </Card>
        )}
      </div>

      {collapsed && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCollapsed(false);
          }}
        >
          <PanelRightOpen aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t('ticket.detail.context.expand')}
        </Button>
      )}
    </div>
  );
}
