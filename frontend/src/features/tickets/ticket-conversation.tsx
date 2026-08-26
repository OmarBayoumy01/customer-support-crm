import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TicketMessage } from '@crm/shared';

import { cn } from '@/lib/utils';

export interface TicketConversationProps {
  messages: readonly TicketMessage[];
  /** The ticket's opening description, which is the first thing in the thread. */
  description: string | null;
  createdAt: string;
  customerName: string;
  className?: string | undefined;
}

/**
 * The conversation — US-45's centre column.
 *
 * **US-46 owns this.** What is here is the minimum that makes the three-column
 * layout real and reviewable: the opening description, then each message in
 * order, with the customer on the inline start and the agent on the inline end.
 * US-46 extends this same component with whatever its criteria ask for rather
 * than replacing it.
 *
 * An internal note is marked with a lock, a border, and the word "Internal
 * note" — three encodings, because the project's first non-negotiable rule
 * lives on this distinction and an agent has to be able to tell at a glance
 * which of these the customer can see. The rule itself is enforced at the API
 * layer (US-82 queries `isInternal: false`); this is the agent's own view,
 * where the note is supposed to appear.
 */
export function TicketConversation({
  messages,
  description,
  createdAt,
  customerName,
  className,
}: TicketConversationProps): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const time = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  return (
    <ol className={cn('space-y-4', className)}>
      {description !== null && description !== '' && (
        <li className="flex flex-col items-start">
          <div className="border-line bg-card max-w-[85%] rounded-md rounded-ss-none border p-3">
            <p className="text-meta text-ink-muted mb-1">
              {customerName} · <time dateTime={createdAt}>{time(createdAt)}</time>
            </p>
            <p className="text-body text-ink whitespace-pre-line">{description}</p>
          </div>
        </li>
      )}

      {messages.map((message) => {
        const fromCustomer = message.senderType === 'CUSTOMER';
        const system = message.senderType === 'SYSTEM';

        if (system) {
          return (
            <li key={message.id} className="flex justify-center">
              <p className="text-meta text-ink-faint bg-secondary rounded-full px-3 py-1">
                {message.body} · <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
              </p>
            </li>
          );
        }

        return (
          <li
            key={message.id}
            className={cn('flex flex-col', fromCustomer ? 'items-start' : 'items-end')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-md border p-3',
                fromCustomer
                  ? 'border-line bg-card rounded-ss-none'
                  : 'border-accent/20 bg-brand-soft rounded-se-none',
                message.isInternal &&
                  // Deliberately unlike either bubble: an internal note is not
                  // part of the conversation, it is a note beside it.
                  'border-sla-warn/40 bg-sla-warn-soft rounded-se-md rounded-ss-md border-dashed',
              )}
            >
              <p className="text-meta text-ink-muted mb-1 flex flex-wrap items-center gap-x-2">
                <span>{message.authorName ?? t('ticket.detail.conversation.unknownAuthor')}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                {message.isInternal && (
                  <span className="text-sla-warn inline-flex items-center gap-1 font-medium">
                    <Lock aria-hidden="true" className="size-3" />
                    {t('ticket.detail.conversation.internalNote')}
                  </span>
                )}
              </p>
              <p className="text-body text-ink whitespace-pre-line">{message.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
