import {
  ChevronUp,
  FileText,
  Globe,
  Image,
  Lock,
  Mail,
  MessageCircle,
  MessagesSquare,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel, TicketAttachment, TicketMessage } from '@crm/shared';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  CHAT: MessagesSquare,
  SMS: Smartphone,
  WEB: Globe,
};

/** Rounded to whole units — nobody needs a file size to three decimal places. */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  const kb = bytes / 1024;

  return kb < 1024 ? `${String(Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * One file on one message — US-46, AC4.
 *
 * Icon, name and size. **Not a link**, because there is nothing to link to:
 * object storage arrives with US-51, and `Attachment.storageKey` currently
 * names a key with no object behind it. A link that 404s teaches people the
 * feature is broken; a chip that says what is attached is honest about where
 * the work stopped.
 */
function AttachmentChip({ attachment }: { attachment: TicketAttachment }): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = attachment.contentType.startsWith('image/') ? Image : FileText;

  return (
    <Badge
      variant="outline"
      className="bg-card text-ink-muted max-w-full rounded-md py-1 font-normal"
      title={t('ticket.detail.conversation.downloadPending')}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      <span className="text-ink truncate">{attachment.fileName}</span>
      <span className="tabular shrink-0">{formatSize(attachment.sizeBytes)}</span>
    </Badge>
  );
}

/** Two letters, from whatever the name gives us. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const second = parts[1] ?? '';
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase() || '?';
}

/**
 * Who wrote it.
 *
 * High contrast initials for customer and agent avatars.
 */
function Author({
  name,
  fromCustomer,
}: {
  name: string;
  fromCustomer: boolean;
}): React.JSX.Element {
  const initials = initialsOf(name);

  return (
    <Avatar className={cn(
      'size-7 shrink-0 select-none border',
      fromCustomer
        ? 'border-border/80 bg-muted text-foreground'
        : 'border-primary/30 bg-primary text-primary-foreground shadow-2xs',
    )}>
      <AvatarFallback
        className={cn(
          'text-[0.6875rem] font-bold',
          fromCustomer
            ? 'bg-muted text-foreground'
            : 'bg-primary text-primary-foreground',
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** The channel a message travelled on — AC3. Icon **and** word, as ever. */
function ChannelTag({ channel }: { channel: Channel }): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = CHANNEL_ICON[channel];

  return (
    <span className="text-ink-faint inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3" />
      {t(`ticket.channel.${channel.toLowerCase()}`)}
    </span>
  );
}

export interface TicketConversationProps {
  messages: readonly TicketMessage[];
  /** The ticket's opening description, which is the first thing in the thread. */
  description: string | null;
  createdAt: string;
  customerName: string;
  /** How many messages the ticket has in total — AC5. */
  messageCount?: number;
  onLoadEarlier?: () => void;
  isLoadingEarlier?: boolean;
  className?: string | undefined;
}

/**
 * The conversation timeline — US-46.
 *
 * Four kinds of entry, and the whole design is about telling them apart at a
 * glance (AC1):
 *
 * - a **customer** message sits on the inline start, in paper;
 * - an **agent** reply sits on the inline end, in the brand tint;
 * - an **internal note** is full width and amber, deliberately unlike either,
 *   because it is not part of the conversation — it is a note beside it;
 * - a **system event** is a small centred muted line, not a bubble at all
 *   (AC6): it is context, and context that shouts is noise.
 *
 * AC2 is the one that matters most. **The project's first non-negotiable rule
 * lives on `isInternal`**, and an agent has to be able to tell without reading
 * whether the customer can see what they are looking at. So an internal note is
 * marked four ways over — full width, amber, a lock, and the words "Not visible
 * to the customer". The rule itself is enforced in the API (US-82 queries
 * `isInternal: false`); this is the belt to that braces, on the one screen
 * where a person could otherwise paste a note into a reply.
 */
export function TicketConversation({
  messages,
  description,
  createdAt,
  customerName,
  messageCount,
  onLoadEarlier,
  isLoadingEarlier = false,
  className,
}: TicketConversationProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const foot = useRef<HTMLLIElement>(null);

  const hasEarlier = messageCount !== undefined && messageCount > messages.length;

  /**
   * AC5 — the view opens on the latest message.
   *
   * A conversation is read from the bottom: what was said last is what you are
   * replying to. Only on mount and only when the thread arrives, so that
   * loading earlier messages does not yank the reader back down to the end of
   * the thread they just scrolled away from.
   */
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only, deliberately
  }, [messages.length > 0]);

  const time = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  return (
    <ol className={cn('space-y-4', className)}>
      {hasEarlier && (
        <li className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadEarlier}
            disabled={isLoadingEarlier || onLoadEarlier === undefined}
          >
            <ChevronUp aria-hidden="true" className="size-4" />
            {isLoadingEarlier
              ? t('common.working')
              : t('ticket.detail.conversation.loadEarlier', {
                  count: messageCount - messages.length,
                })}
          </Button>
        </li>
      )}

      {description !== null && description !== '' && (
        <li className="flex flex-col items-start">
          <div className="border border-border/70 bg-card max-w-[85%] rounded-2xl rounded-ss-xs p-4 shadow-2xs">
            <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <span className="font-semibold text-foreground">{customerName}</span>
              <span>·</span>
              <time dateTime={createdAt}>{time(createdAt)}</time>
            </p>
            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{description}</p>
          </div>
        </li>
      )}

      {messages.map((message) => {
        // AC6 — a status change is context, not correspondence.
        if (message.senderType === 'SYSTEM') {
          return (
            <li key={message.id} className="flex justify-center my-2">
              <p className="text-xs text-muted-foreground bg-muted/80 border px-3.5 py-1 rounded-full text-center shadow-2xs">
                {message.body} · <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
              </p>
            </li>
          );
        }

        const fromCustomer = message.senderType === 'CUSTOMER';

        // AC2 — an internal note breaks the bubble geometry on purpose.
        if (message.isInternal) {
          return (
            <li key={message.id} className="my-2">
              <div className="rounded-xl border border-dashed border-sla-warn/40 bg-sla-warn-soft border-s-4 border-s-sla-warn p-4 shadow-2xs">
                <p className="text-xs mb-1.5 flex flex-wrap items-center gap-x-2">
                  <span className="text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 font-semibold">
                    <Lock aria-hidden="true" className="size-3.5" />
                    {t('ticket.detail.conversation.notVisibleToCustomer')}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground/60">
                    ·
                  </span>
                  <span className="text-muted-foreground font-medium">
                    {message.authorName ?? t('ticket.detail.conversation.unknownAuthor')}
                  </span>
                  <time className="text-muted-foreground" dateTime={message.createdAt}>
                    {time(message.createdAt)}
                  </time>
                </p>
                <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{message.body}</p>
                {message.attachments.length > 0 && (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id} className="min-w-0">
                        <AttachmentChip attachment={attachment} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        }

        const author = message.authorName ?? t('ticket.detail.conversation.unknownAuthor');

        return (
          <li
            key={message.id}
            className={cn(
              'flex items-start gap-2.5 my-2',
              fromCustomer ? 'justify-start' : 'flex-row-reverse justify-start',
            )}
          >
            <Author name={author} fromCustomer={fromCustomer} />

            <div
              className={cn(
                'max-w-[85%] min-w-0 rounded-2xl border p-4 shadow-2xs',
                fromCustomer
                  ? 'border-border/70 bg-card rounded-ss-xs'
                  : 'border-primary/25 bg-primary/10 rounded-se-xs',
              )}
            >
              <p className="text-xs text-muted-foreground mb-1.5 flex flex-wrap items-center gap-x-2">
                <span className="font-semibold text-foreground">{author}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                {message.channel !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <ChannelTag channel={message.channel} />
                  </>
                )}
              </p>
              <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{message.body}</p>
              {message.attachments.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {message.attachments.map((attachment) => (
                    <li key={attachment.id} className="min-w-0">
                      <AttachmentChip attachment={attachment} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}

      {/* The anchor the view scrolls to on arrival. */}
      <li ref={foot} aria-hidden="true" className="h-0" />
    </ol>
  );
}
