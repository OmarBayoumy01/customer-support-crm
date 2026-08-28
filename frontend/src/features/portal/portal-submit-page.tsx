import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, LifeBuoy, LoaderCircle } from 'lucide-react';
import { PORTAL_URGENCY, type PortalTicketDetail, type SubmitPortalTicket } from '@crm/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LanguageToggle } from '@/components/language-toggle';
import { useAuth } from '@/features/auth/auth-context';
import { usePortalCategories, usePortalSubmit } from './use-portal';
import { PortalProfileDialog } from './portal-profile-dialog';

/** `null` cannot travel in a `<Select>` value, so absence gets a name. */
const NO_CATEGORY = '__none__';

/**
 * What the customer fills in — AC1's list, minus the two that cannot exist yet.
 *
 * Attachments are absent because object storage is US-51 and there is nowhere to
 * put a file; a picker that cannot upload is worse than no picker. That also
 * takes AC6's limit message with it. Both are flagged in the plan rather than
 * approximated.
 */
interface FormValues {
  subject: string;
  categoryId: string;
  urgency: SubmitPortalTicket['urgency'] | '';
  description: string;
  preferredContact: string;
}

/** How they would like to be reached. Recorded, never sent to — P13 owns channels. */
const CONTACT_METHODS = ['EMAIL', 'WHATSAPP', 'SMS'] as const;

/**
 * The confirmation — AC4.
 *
 * A state of the same route rather than a redirect, so the request number is
 * still on screen while the customer reads it. A redirect to a list would take
 * the one thing they need to write down away at the moment they need it.
 */
function Confirmation({ ticket, email }: { ticket: PortalTicketDetail; email: string | null }) {
  const { t } = useTranslation();

  return (
    <Card role="status" className="mt-8">
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="text-sla-ok mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="text-section font-semibold">{t('portal.submit.done.title')}</h2>

            {/* The number, in the words a person would use to quote it. */}
            <p className="text-body text-ink mt-2">
              {t('portal.submit.done.number', { number: ticket.number })}
            </p>

            {email === null ? null : (
              <p className="text-body text-ink-muted mt-1">
                {t('portal.submit.done.updates', { email })}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/portal">{t('portal.submit.done.home')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Raise a request — US-86.
 *
 * Short and plain by design: the story's whole point is that asking for help
 * should not feel like filling in a support system. Six fields in the criteria,
 * four of which exist today, and no internal vocabulary anywhere on the screen.
 */
export function PortalSubmitPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const categories = usePortalCategories();
  const submit = usePortalSubmit();
  const [done, setDone] = useState<PortalTicketDetail | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      subject: '',
      categoryId: NO_CATEGORY,
      urgency: '',
      description: '',
      preferredContact: 'EMAIL',
    },
  });

  const onSubmit = useCallback(
    (values: FormValues) => {
      submit.mutate(
        {
          subject: values.subject.trim(),
          description: values.description.trim(),
          ...(values.categoryId === NO_CATEGORY ? {} : { categoryId: values.categoryId }),
          urgency: values.urgency as SubmitPortalTicket['urgency'],
          ...(values.preferredContact === ''
            ? {}
            : { preferredContact: values.preferredContact as 'EMAIL' }),
        },
        { onSuccess: setDone },
      );
    },
    [submit],
  );

  const urgency = watch('urgency');
  const categoryId = watch('categoryId');

  return (
    <div className="bg-background min-h-screen text-foreground">
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

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-page font-semibold">{t('portal.submit.title')}</h1>
        <p className="text-ink-muted mt-1">{t('portal.submit.subtitle')}</p>

        {done !== null ? (
          <Confirmation ticket={done} email={user?.email ?? null} />
        ) : (
          <>
            {submit.isError ? (
              <div
                role="alert"
                className="border-sla-breach/30 bg-sla-breach-soft text-sla-breach mt-6 flex items-start gap-2 rounded-md border px-3 py-2.5"
              >
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="text-body">{t('portal.submit.errors.failed')}</span>
              </div>
            ) : (
              <p className="text-meta text-ink-muted mt-6">{t('portal.submit.noArticles')}</p>
            )}

            <form
              onSubmit={(event) => void handleSubmit(onSubmit)(event)}
              noValidate
              className="mt-6"
            >
              <div className="mb-5">
                <Label htmlFor="subject" className="mb-1.5">
                  {t('portal.submit.subject')}
                </Label>
                <Input
                  id="subject"
                  className="text-start"
                  placeholder={t('portal.submit.subjectPlaceholder')}
                  aria-invalid={errors.subject === undefined ? undefined : true}
                  aria-describedby={errors.subject === undefined ? undefined : 'subject-error'}
                  // AC5 — the words a person would use, not a validator's.
                  {...register('subject', {
                    validate: (value) =>
                      value.trim().length >= 3 || t('portal.submit.errors.subject'),
                  })}
                />
                {errors.subject === undefined ? null : (
                  <p id="subject-error" className="text-sla-breach text-meta mt-1.5">
                    {errors.subject.message}
                  </p>
                )}
              </div>

              <div className="mb-5">
                <Label htmlFor="category" className="mb-1.5">
                  {t('portal.submit.category')}
                </Label>
                <Select
                  value={categoryId}
                  onValueChange={(value) => {
                    setValue('categoryId', value);
                  }}
                >
                  <SelectTrigger id="category" aria-label={t('portal.submit.category')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t('portal.submit.notSure')}</SelectItem>
                    {(categories.data ?? []).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/*
                AC2 — plain descriptions. `LOW`, `MEDIUM` and `HIGH` appear
                nowhere on this screen or on the wire; the mapping is the
                server's, and there is no option that reaches the tightest
                priority.
              */}
              <div className="mb-5">
                <Label htmlFor="urgency" className="mb-1.5">
                  {t('portal.submit.urgency')}
                </Label>
                <Select
                  value={urgency}
                  onValueChange={(value) => {
                    setValue('urgency', value as SubmitPortalTicket['urgency'], {
                      shouldValidate: true,
                    });
                  }}
                >
                  <SelectTrigger
                    id="urgency"
                    aria-label={t('portal.submit.urgency')}
                    aria-invalid={errors.urgency === undefined ? undefined : true}
                  >
                    <SelectValue placeholder={t('portal.submit.urgencyPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {PORTAL_URGENCY.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`portal.submit.urgencyOptions.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  {...register('urgency', {
                    validate: (value) => value !== '' || t('portal.submit.errors.urgency'),
                  })}
                />
                {errors.urgency === undefined ? null : (
                  <p className="text-sla-breach text-meta mt-1.5">{errors.urgency.message}</p>
                )}
              </div>

              <div className="mb-5">
                <Label htmlFor="description" className="mb-1.5">
                  {t('portal.submit.description')}
                </Label>
                <Textarea
                  id="description"
                  rows={6}
                  className="text-start"
                  placeholder={t('portal.submit.descriptionPlaceholder')}
                  aria-invalid={errors.description === undefined ? undefined : true}
                  aria-describedby={
                    errors.description === undefined ? undefined : 'description-error'
                  }
                  {...register('description', {
                    validate: (value) =>
                      value.trim().length >= 1 || t('portal.submit.errors.description'),
                  })}
                />
                {errors.description === undefined ? null : (
                  <p id="description-error" className="text-sla-breach text-meta mt-1.5">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="mb-6">
                <Label htmlFor="contact" className="mb-1.5">
                  {t('portal.submit.contact')}
                </Label>
                <Select
                  value={watch('preferredContact')}
                  onValueChange={(value) => {
                    setValue('preferredContact', value);
                  }}
                >
                  <SelectTrigger id="contact" aria-label={t('portal.submit.contact')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {t(`portal.submit.contactOptions.${method.toLowerCase()}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={submit.isPending}
                  aria-busy={submit.isPending}
                  className="gap-2"
                >
                  {submit.isPending ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  {submit.isPending ? t('portal.submit.sending') : t('portal.submit.send')}
                </Button>
                <Button asChild variant="ghost">
                  <Link to="/portal">{t('portal.submit.cancel')}</Link>
                </Button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
