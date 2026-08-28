import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, LoaderCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface DeleteTicketDialogProps {
  ticketNumber: number;
  onConfirm: () => Promise<void> | void;
  isDeleting: boolean;
  triggerButton?: React.ReactNode;
}

export function DeleteTicketDialog({
  ticketNumber,
  onConfirm,
  isDeleting,
  triggerButton,
}: DeleteTicketDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const targetUpper = 'DELETE';
  const isMatch =
    confirmText.trim().toUpperCase() === targetUpper ||
    confirmText.trim() === `#${ticketNumber}` ||
    confirmText.trim() === String(ticketNumber);

  const handleDelete = async () => {
    if (!isMatch || isDeleting) return;
    await onConfirm();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText('');
      }}
    >
      <DialogTrigger asChild>
        {triggerButton ?? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive shadow-2xs"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            <span>{t('ticket.delete.button')}</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md rounded-2xl p-6">
        <DialogHeader>
          <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-1">
            <AlertTriangle aria-hidden="true" className="size-5" />
          </div>
          <DialogTitle className="text-base font-bold text-foreground">
            {t('ticket.delete.title', { number: ticketNumber })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t('ticket.delete.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 space-y-3">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-xs text-destructive">
            <p className="font-semibold">{t('ticket.delete.prompt')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm-input" className="text-xs font-medium text-foreground">
              {t('ticket.delete.placeholder')}
            </Label>
            <Input
              id="delete-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-9 text-xs uppercase tracking-wider font-mono"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter className="mt-4 flex gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!isMatch || isDeleting}
            onClick={() => void handleDelete()}
            className="gap-2 shadow-xs"
          >
            {isDeleting ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
            {isDeleting ? t('ticket.delete.deleting') : t('ticket.delete.confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
