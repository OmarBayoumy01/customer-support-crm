import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  /** The control that opens it. */
  trigger: ReactNode;
  /** What is about to happen, in the action's own words. */
  title: string;
  /** The consequence, in one sentence. */
  description: string;
  /**
   * The confirm button's label.
   *
   * **The verb, not "OK".** An action keeps its name through the whole flow, so
   * the button that says "Resolve" produces a ticket that says Resolved. "OK"
   * makes the reader reconstruct what they clicked, which is exactly the moment
   * they are least able to.
   */
  confirmLabel: string;
  /**
   * Whether this destroys something.
   *
   * Kept here rather than as a free `variant` prop so the red treatment cannot
   * be applied to a harmless action by whoever is in a hurry.
   */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * A confirmation, for actions that cannot be undone — US-27.
 *
 * Radix traps focus and closes on Escape; both are asserted in the tests rather
 * than assumed, because **Escape must cancel and never confirm**. Getting that
 * the wrong way round is how a safety dialog becomes the thing that fires the
 * action.
 *
 * The consumers in this slice are US-47 resolving or closing a ticket and
 * US-48 reassigning one away from somebody.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            aria-busy={pending}
            className={cn(
              destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
            onClick={(event) => {
              // Held open while the action runs, so a slow request does not
              // leave the user wondering whether the click registered — and so
              // it cannot be clicked twice.
              event.preventDefault();
              setPending(true);

              void Promise.resolve(onConfirm()).finally(() => {
                setPending(false);
                setOpen(false);
              });
            }}
          >
            {pending ? t('common.working') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
