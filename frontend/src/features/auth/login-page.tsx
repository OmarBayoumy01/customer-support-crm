import { useCallback, useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Headphones,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  User,
} from 'lucide-react';
import { LoginRequestSchema, type LoginRequest } from '@crm/shared';

import { LanguageToggle } from '@/components/language-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ApiRequestError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ServiceStatus } from './service-status';
import { useLogin } from './use-login';

const DEMO_ACCOUNTS = [
  {
    key: 'manager',
    email: 'manager@crm.local',
    Icon: ShieldCheck,
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  {
    key: 'agent',
    email: 'agent@crm.local',
    Icon: Headphones,
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  {
    key: 'customer',
    email: 'customer@crm.local',
    Icon: User,
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
] as const;

/**
 * Turns a failed request into something a person can read.
 *
 * Switches on the **code**, never the message: US-7 split them precisely so the
 * server's wording can change without breaking the client. `UNAUTHENTICATED`
 * covers both a wrong password and an unknown email, and it must stay that way
 * — AC2 is that the two are indistinguishable, and rendering different copy for
 * them here would leak from the UI what the API was careful not to.
 */
function messageKeyFor(error: ApiRequestError): string {
  switch (error.code) {
    case 'UNAUTHENTICATED':
      return 'login.errors.invalidCredentials';
    /**
     * Nothing this form does answers 422 any more.
     *
     * It used to: there were two login endpoints, and each refused the other
     * kind of account. There is one now, and it decides which application an
     * account belongs to instead of refusing it, so this code would only
     * arrive as a surprise — which is what the generic message is for.
     */
    case 'UNPROCESSABLE':
      return 'login.errors.unexpected';
    case 'FORBIDDEN':
      return 'login.errors.inactiveAccount';
    case 'RATE_LIMITED':
      return 'login.errors.rateLimited';
    case 'NETWORK_ERROR':
      return 'login.errors.offline';
    default:
      return 'login.errors.unexpected';
  }
}

/**
 * The panel beside the form.
 *
 * A sign-in screen is usually where a product puts a stock illustration. This
 * one puts the **desk's own operational state**, because that is what this
 * product is about and because it answers the question somebody staring at a
 * failed sign-in actually has: is it me, or is it the platform?
 *
 * Inverted graphite rather than the usual paper. It is not a dark theme — it is
 * one deliberately heavy field, which is what gives the single indigo accent on
 * the form beside it something to be bright against.
 */
function DeskPanel(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <aside className="bg-ink hidden flex-col justify-between p-10 lg:flex">
      <div className="flex items-center gap-2.5">
        <Headphones aria-hidden="true" className="size-5 text-white/80" />
        <span className="text-section font-semibold text-white">{t('common.appName')}</span>
      </div>

      <div className="max-w-xs">
        {/*
          The one large piece of type on the screen. Not a slogan — a plain
          statement of what the person is about to open.
        */}
        <p className="text-[1.75rem] leading-9 font-semibold text-white">{t('signIn.headline')}</p>
        <p className="text-body mt-3 text-white/55">{t('signIn.subhead')}</p>
      </div>

      {/*
        One form serves both applications now, so a customer sees this too. It
        says whether the desk is up, which is the question anybody staring at a
        failed sign-in has, whichever side of it they are on — and it reports
        nothing beyond that.
      */}
      <ServiceStatus />
    </aside>
  );
}

/**
 * The sign-in screen — one form for everybody.
 *
 * It used to take a `variant`, because there were two endpoints and the token
 * audience was decided by which was called. The audience is now decided from
 * the **account**, so there is one door, one set of copy, and nothing for the
 * person signing in to know in advance: `useLogin` reads the answer and sends
 * them to the staff workspace or to the portal accordingly.
 */
export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const login = useLogin();
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  /**
   * The **shared** schema supplies the rules; this supplies the words.
   *
   * Restating the rules here with translated messages would put the email
   * normalisation that the brute-force counter depends on in two places, and
   * they would drift. So the shared resolver runs first and its messages are
   * replaced afterwards, keyed on the field and the Zod issue code that
   * `zodResolver` records as `type`.
   *
   * It cannot be done with a Zod `errorMap`: an explicit message on the schema
   * — and the shared schema has them, because they are also the API's own error
   * text — takes precedence over any map.
   */
  const resolver = useMemo<Resolver<LoginRequest>>(() => {
    const base = zodResolver(LoginRequestSchema);

    const messageKey = (field: string, type: string): string | undefined => {
      if (field === 'email' && type === 'too_small') return 'login.errors.emailRequired';
      if (field === 'email' && type === 'invalid_string') return 'login.errors.emailInvalid';
      if (field === 'password' && type === 'too_small') return 'login.errors.passwordRequired';
      return undefined;
    };

    return async (values, context, options) => {
      const result = await base(values, context, options);

      for (const [field, error] of Object.entries(result.errors)) {
        const key = messageKey(field, String(error?.type ?? ''));

        if (key !== undefined && error !== undefined) {
          error.message = t(key);
        }
      }

      return result;
    };
  }, [t]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginRequest>({
    resolver,
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = useCallback(
    (values: LoginRequest) => {
      login.mutate(values);
    },
    [login],
  );

  const fillAccount = useCallback(
    (email: string) => {
      setValue('email', email, { shouldValidate: true });
      setValue('password', 'DevPassw0rd!', { shouldValidate: true });
    },
    [setValue],
  );

  const isSubmitting = login.isPending;

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,26rem)_1fr]">
      <DeskPanel />

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-3">
            <div>
              {/* Shown only where the panel is not — no duplicate wordmark. */}
              <div className="mb-5 flex items-center gap-2 lg:hidden">
                <Headphones aria-hidden="true" className="text-ink size-5" />
                <span className="text-section font-semibold">{t('common.appName')}</span>
              </div>
              <h1 className="text-page font-semibold">{t('login.title')}</h1>
              <p className="text-ink-muted mt-1">{t('login.subtitle')}</p>
            </div>
            <LanguageToggle />
          </div>

          {/*
            One live region for the request-level error. `role="alert"` so a
            screen reader announces it without the user having to go looking,
            and it sits before the fields so tab order reaches it naturally.
          */}
          {login.isError ? (
            <div
              role="alert"
              className="border-sla-breach/30 bg-sla-breach-soft text-sla-breach mb-5 flex items-start gap-2 rounded-md border px-3 py-2.5"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="text-body">{t(messageKeyFor(login.error))}</span>
            </div>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
            <div className="mb-4">
              <Label htmlFor="email" className="mb-1.5">
                {t('login.email')}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                // `text-start`, not `text-left` — the field aligns with the
                // reading direction rather than to one fixed side.
                className="text-start"
                placeholder={t('login.emailPlaceholder')}
                aria-invalid={errors.email === undefined ? undefined : true}
                aria-describedby={errors.email === undefined ? undefined : 'email-error'}
                {...register('email')}
              />
              {errors.email === undefined ? null : (
                <p id="email-error" className="text-sla-breach text-meta mt-1.5">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="mb-6">
              <Label htmlFor="password" className="mb-1.5">
                {t('login.password')}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  // Room for the reveal control, on whichever side the language
                  // puts it.
                  className="text-start pe-10"
                  aria-invalid={errors.password === undefined ? undefined : true}
                  aria-describedby={cn(
                    errors.password === undefined ? '' : 'password-error',
                    capsLock ? 'caps-warning' : '',
                  ).trim()}
                  onKeyUp={(event) => {
                    setCapsLock(event.getModifierState('CapsLock'));
                  }}
                  {...register('password')}
                />
                {/*
                  A reveal, not a "show password" checkbox below the field. On a
                  shared support floor the ability to check what you typed
                  without it staying on screen is the point.
                */}
                <button
                  type="button"
                  onClick={() => {
                    setRevealed((value) => !value);
                  }}
                  aria-label={t(revealed ? 'login.hidePassword' : 'login.showPassword')}
                  aria-pressed={revealed}
                  className="text-ink-muted hover:text-ink absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-md"
                >
                  {revealed ? (
                    <EyeOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Eye aria-hidden="true" className="size-4" />
                  )}
                </button>
              </div>
              {errors.password === undefined ? null : (
                <p id="password-error" className="text-sla-breach text-meta mt-1.5">
                  {errors.password.message}
                </p>
              )}
              {/*
                Caps Lock is the single most common cause of a password that
                "should work". Cheap to detect, and it saves a support ticket
                on a product whose whole job is support tickets.
              */}
              {capsLock ? (
                <p id="caps-warning" className="text-sla-warn text-meta mt-1.5">
                  {t('login.capsLock')}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="w-full gap-2"
            >
              {isSubmitting ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {isSubmitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>

          {/* Quick Demo & Test Accounts */}
          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50/75 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t('login.demoAccounts.title')}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <KeyRound aria-hidden="true" className="size-3 text-slate-400" />
                <span>DevPassw0rd!</span>
              </div>
            </div>

            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map(({ key, email, Icon, badgeClass }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => fillAccount(email)}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200/80 bg-white px-2.5 py-1.5 text-start transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-700/60 dark:bg-slate-800/80 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/30"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn('rounded p-1 border text-xs', badgeClass)}>
                      <Icon aria-hidden="true" className="size-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {t(`login.demoAccounts.${key}.role`)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{email}</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {t('common.create') === 'Create' ? 'Fill' : 'تعبئة'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

