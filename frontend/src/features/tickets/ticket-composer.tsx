import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Reply, Send } from 'lucide-react';
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
  isResolved?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Reply, or write a note — US-1.
 */
export function TicketComposer({ ticketId, isResolved, className }: TicketComposerProps): React.JSX.Element {
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
      toastError(error, {
        onRetry: () => {
          submit();
        },
      });
    },
  });

  function submit(): void {
    if (isResolved || body.trim() === '') {
      return;
    }

    send.mutate({ body: body.trim(), isInternal: isNote });
  }

  /** AC3 — warn before the mode changes, but never lose the draft. */
  function requestMode(next: Mode): void {
    if (isResolved || next === mode) {
      return;
    }

    if (body.trim() === '') {
      setMode(next);
      return;
    }

    setPendingMode(next);
  }

  if (isResolved) {
    return (
      <div className={cn('border-t p-4 bg-muted/30', className)}>
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-800 dark:text-emerald-300 shadow-2xs">
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t('ticket.composer.resolvedNotice')}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'space-y-2 border-t p-5 transition-colors',
        isNote
          ? 'border-sla-warn/40 bg-sla-warn-soft'
          : 'border-border/60 bg-muted/20',
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
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="reply" className="gap-1.5 text-xs">
              <Reply aria-hidden="true" className="size-3.5" />
              {t('ticket.composer.reply')}
            </TabsTrigger>
            <TabsTrigger value="note" className="gap-1.5 text-xs">
              <Lock aria-hidden="true" className="size-3.5" />
              {t('ticket.composer.note')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isNote && (
        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5 font-medium">
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
        className={cn(
          'bg-card resize-y min-h-[5rem] rounded-xl border-border/80 shadow-2xs focus-visible:ring-1',
          isNote && 'border-amber-500/40 focus-visible:border-amber-500',
        )}
      />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          onClick={submit}
          disabled={body.trim() === '' || send.isPending}
          className={cn(
            'gap-1.5 shadow-2xs',
            isNote && 'bg-amber-600 hover:bg-amber-700 text-white',
          )}
        >
          {send.isPending ? (
            t('common.working')
          ) : isNote ? (
            <>
              <Lock aria-hidden="true" className="size-3.5" />
              {t('ticket.composer.addNote')}
            </>
          ) : (
            <>
              <Send aria-hidden="true" className="size-3.5" />
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
