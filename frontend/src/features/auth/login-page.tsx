import { useCallback, useMemo } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { LoginRequestSchema, type LoginRequest } from '@crm/shared';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

import { LanguageToggle } from '../../components/language-toggle';
import type { ApiRequestError } from '../../lib/api-client';
import { useLogin } from './use-login';

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

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const login = useLogin();

  /**
   * The **shared** schema supplies the rules; this supplies the words.
   *
   * Restating the rules here with translated messages would put the email
   * normalisation that the brute-force counter depends on in two places, and
   * they would drift. So the shared resolver runs first and its messages are
   * replaced afterwards, keyed on the field and the Zod issue code that
   * `zodResolver` records as `type`.
   *
   * Note it cannot be done with a Zod `errorMap`: an explicit message on the
   * schema — and the shared schema has them, because they are also the API's
   * own error text — takes precedence over any map.
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

  const isSubmitting = login.isPending;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{t('login.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('login.subtitle')}</p>
          </div>
          <LanguageToggle />
        </div>

        {/*
          One live region for the request-level error. `role="alert"` so a
          screen reader announces it without the user having to go looking, and
          it is rendered *before* the fields so tab order reaches it naturally.
        */}
        {login.isError ? (
          <Alert variant="destructive" role="alert" className="mb-4">
            <AlertDescription>{t(messageKeyFor(login.error))}</AlertDescription>
          </Alert>
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
              // `text-start`, not `text-left` — the field aligns with the
              // reading direction rather than to one fixed side.
              className="text-start"
              placeholder={t('login.emailPlaceholder')}
              aria-invalid={errors.email === undefined ? undefined : true}
              aria-describedby={errors.email === undefined ? undefined : 'email-error'}
              {...register('email')}
            />
            {errors.email === undefined ? null : (
              <p id="email-error" className="text-destructive mt-1 text-sm">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="mb-6">
            <Label htmlFor="password" className="mb-1.5">
              {t('login.password')}
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className="text-start"
              aria-invalid={errors.password === undefined ? undefined : true}
              aria-describedby={errors.password === undefined ? undefined : 'password-error'}
              {...register('password')}
            />
            {errors.password === undefined ? null : (
              <p id="password-error" className="text-destructive mt-1 text-sm">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="w-full">
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </div>
    </main>
  );
}
