import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Reply, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateTicketMessage, TicketMessage } from '@crm/shared';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiPost } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ticketDetailKey } from './use-ticket-detail';

type Mode = 'reply' | 'note';

export interface TicketComposerProps {
  ticketId: string;
  className?: string | undefined;
}

/**
 * Reply, or write a note — US-1.
 *
 * **The risk this story exists to mitigate is an agent sending private context
 * to a customer**, which the story itself calls a trust and confidentiality
 * issue rather than a cosmetic one. Everything below follows from that:
 *
 * - Reply is the default (AC1), because the safe-by-accident case should be the
 *   customer-facing one an agent is expecting.
 * - Note mode changes the **whole** composer, not a checkbox somewhere (AC2).
 *   A single toggle you can miss is exactly how the accident happens.
 * - Switching with text already typed asks first (AC3). The text survives
 *   either way; what the dialog buys is a moment's attention at the one point
 *   where a note could become a reply.
 * - The button changes its verb (AC6), so the last thing an agent reads before
 *   committing says which of the two they are doing.
 *
 * The mode is deliberately **not** in the URL. Everything else on this screen
 * is shareable state; a half-written note is not, and a link that opens
 * somebody else's composer in note mode is a way to get this wrong.
 */
export function TicketComposer({ ticketId, className }: TicketComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('reply');
  const [body, setBody] = useState('');
  /** The mode a confirmed switch would land on, or null when nothing is pending. */
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);

  const isNote = mode === 'note';

  const send = useMutation({
    mutationFn: async (input: CreateTicketMessage) =>
      apiPost<TicketMessage>(`/tickets/${ticketId}/messages`, input),
    onSuccess: (message) => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ticketDetailKey(ticketId) });
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'messages', ticketId] });

      toastSuccess(
        message.isInternal ? t('ticket.composer.noteAdded') : t('ticket.composer.replySent'),
      );
    },
    onError: (error: unknown) => {
      // The draft is deliberately left in the box: losing what somebody just
      // wrote because the network blinked is the worst possible response to a
      // failure that retrying would fix.
      toastError(error, {
        onRetry: () => {
          submit();
        },
      });
    },
  });

  function submit(): void {
    if (body.trim() === '') {
      return;
    }

    send.mutate({ body: body.trim(), isInternal: isNote });
  }

  /** AC3 — warn before the mode changes, but never lose the draft. */
  function requestMode(next: Mode): void {
    if (next === mode) {
      return;
    }

    if (body.trim() === '') {
      setMode(next);
      return;
    }

    setPendingMode(next);
  }

  return (
    <div
      className={cn(
        'space-y-2 border-t p-4 transition-colors',
        // AC2 — the whole composer, not a corner of it.
        isNote ? 'border-sla-warn/30 bg-sla-warn-soft' : 'bg-secondary/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={mode}
          onValueChange={(next) => {
            requestMode(next as Mode);
          }}
        >
          <TabsList>
            <TabsTrigger value="reply" className="gap-1.5">
              <Reply aria-hidden="true" className="size-3.5" />
              {t('ticket.composer.reply')}
            </TabsTrigger>
            <TabsTrigger value="note" className="gap-1.5">
              <Lock aria-hidden="true" className="size-3.5" />
              {t('ticket.composer.note')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/*
        AC2 — the label sits above the text area, in words, with the icon. Not a
        tooltip and not a placeholder: it has to be readable at the moment the
        agent is typing, which is when it matters.
      */}
      {isNote && (
        <p className="text-meta text-sla-warn flex items-center gap-1.5 font-medium">
          <Lock aria-hidden="true" className="size-3.5" />
          {t('ticket.composer.noteWarning')}
        </p>
      )}

      <Textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        rows={3}
        aria-label={isNote ? t('ticket.composer.note') : t('ticket.composer.reply')}
        placeholder={
          isNote ? t('ticket.composer.notePlaceholder') : t('ticket.composer.replyPlaceholder')
        }
        className={cn('bg-card resize-y', isNote && 'border-sla-warn/40')}
      />

      <div className="flex items-center justify-end gap-2">
        {/*
          AC6 — the verb changes with the mode, and "send and resolve" is not
          offered on a note. Resolving a ticket by writing a private note would
          leave the customer with silence and a closed ticket.
        */}
        <Button onClick={submit} disabled={body.trim() === '' || send.isPending}>
          {send.isPending ? (
            t('common.working')
          ) : isNote ? (
            <>
              <Lock aria-hidden="true" />
              {t('ticket.composer.addNote')}
            </>
          ) : (
            <>
              <Send aria-hidden="true" />
              {t('ticket.composer.send')}
            </>
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingMode(null);
          }
        }}
        title={
          pendingMode === 'note'
            ? t('ticket.composer.switchToNoteTitle')
            : t('ticket.composer.switchToReplyTitle')
        }
        description={
          pendingMode === 'note'
            ? t('ticket.composer.switchToNoteBody')
            : t('ticket.composer.switchToReplyBody')
        }
        confirmLabel={
          pendingMode === 'note' ? t('ticket.composer.note') : t('ticket.composer.reply')
        }
        onConfirm={() => {
          if (pendingMode !== null) {
            // The draft carries over — AC3 is "preserved *and* warned", not
            // "warned *then* discarded".
            setMode(pendingMode);
          }

          setPendingMode(null);
        }}
      />
    </div>
  );
}
