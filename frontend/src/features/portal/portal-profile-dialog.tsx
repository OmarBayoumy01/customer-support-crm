import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Mail,
  Phone,
  User,
} from 'lucide-react';
import {
  LocaleSchema,
  type Channel,
  type Locale,
  type UpdatePortalProfile,
} from '@crm/shared';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePortalProfile, useUpdatePortalProfile } from './use-portal';

const ProfileFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  phone: z.string().trim().max(50).optional(),
  companyName: z.string().trim().max(200).optional(),
  preferredLocale: LocaleSchema.optional(),
  preferredChannel: z.string().optional(),
});

type ProfileFormData = z.infer<typeof ProfileFormSchema>;

export function PortalProfileDialog(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);

  const { data: profile, isLoading } = usePortalProfile();
  const updateProfile = useUpdatePortalProfile();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(ProfileFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phone: '',
      companyName: '',
      preferredLocale: 'EN',
      preferredChannel: '__none__',
    },
  });

  const preferredLocaleValue = watch('preferredLocale');
  const preferredChannelValue = watch('preferredChannel');

  useEffect(() => {
    if (open && profile !== undefined) {
      reset({
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? '',
        companyName: profile.companyName ?? '',
        preferredLocale: profile.preferredLocale,
        preferredChannel: profile.preferredChannel ?? '__none__',
      });
      setSuccess(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (formData: ProfileFormData) => {
    setSuccess(false);

    const payload: UpdatePortalProfile = {
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      phone: formData.phone?.trim() ? formData.phone.trim() : null,
      companyName: formData.companyName?.trim() ? formData.companyName.trim() : null,
      preferredLocale: formData.preferredLocale,
      preferredChannel:
        formData.preferredChannel && formData.preferredChannel !== '__none__'
          ? (formData.preferredChannel as Channel)
          : null,
    };

    updateProfile.mutate(payload, {
      onSuccess: (updated) => {
        setSuccess(true);
        if (updated.preferredLocale) {
          const lang = updated.preferredLocale.toLowerCase();
          if (i18n.language !== lang) {
            void i18n.changeLanguage(lang);
          }
        }
      },
    });
  };

  const isSubmitting = updateProfile.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <User aria-hidden="true" className="size-4" />
          {t('portal.profile.button')}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl md:max-w-2xl rounded-2xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <User aria-hidden="true" className="size-5 text-primary" />
            {t('portal.profile.title')}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{t('portal.profile.description')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form
            onSubmit={(event) =>
              void handleSubmit(
                onSubmit,
                (errs) => {
                  console.error('FORM VALIDATION ERRORS:', JSON.stringify(errs));
                },
              )(event)
            }
            className="space-y-5 py-3"
          >
            {success ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{t('portal.profile.success')}</span>
              </div>
            ) : null}

            {updateProfile.isError ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
              >
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                <span>{t('portal.profile.error')}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="profile-first-name" className="text-xs font-medium">
                  {t('portal.profile.firstName')} *
                </Label>
                <Input
                  id="profile-first-name"
                  className="mt-1.5 h-9 text-xs"
                  aria-invalid={errors.firstName ? true : undefined}
                  {...register('firstName')}
                />
                {errors.firstName ? (
                  <p className="mt-1 text-[11px] text-destructive">{errors.firstName.message}</p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="profile-last-name" className="text-xs font-medium">
                  {t('portal.profile.lastName')} *
                </Label>
                <Input
                  id="profile-last-name"
                  className="mt-1.5 h-9 text-xs"
                  aria-invalid={errors.lastName ? true : undefined}
                  {...register('lastName')}
                />
                {errors.lastName ? (
                  <p className="mt-1 text-[11px] text-destructive">{errors.lastName.message}</p>
                ) : null}
              </div>
            </div>

            <div>
              <Label htmlFor="profile-email" className="text-xs font-medium">
                {t('portal.profile.email')}
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="profile-email"
                  type="email"
                  disabled
                  value={profile?.email ?? ''}
                  className="bg-muted text-muted-foreground pe-8 text-xs cursor-not-allowed h-9"
                />
                <Mail
                  aria-hidden="true"
                  className="pointer-events-none absolute end-2.5 top-2.5 size-4 text-muted-foreground"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t('portal.profile.emailNotice')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="profile-phone" className="text-xs font-medium">
                  {t('portal.profile.phone')}
                </Label>
                <div className="relative mt-1.5">
                  <Input
                    id="profile-phone"
                    placeholder={t('portal.profile.phonePlaceholder')}
                    className="pe-8 text-xs h-9"
                    {...register('phone')}
                  />
                  <Phone
                    aria-hidden="true"
                    className="pointer-events-none absolute end-2.5 top-2.5 size-3.5 text-muted-foreground"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="profile-company" className="text-xs font-medium">
                  {t('portal.profile.companyName')}
                </Label>
                <Input
                  id="profile-company"
                  placeholder={t('portal.profile.companyPlaceholder')}
                  className="mt-1.5 text-xs h-9"
                  {...register('companyName')}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="profile-channel" className="text-xs font-medium">
                  {t('portal.profile.preferredChannel')}
                </Label>
                <Select
                  value={preferredChannelValue ?? '__none__'}
                  onValueChange={(val) => setValue('preferredChannel', val)}
                >
                  <SelectTrigger id="profile-channel" className="mt-1.5 text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="EMAIL">{t('portal.profile.channelOptions.email')}</SelectItem>
                    <SelectItem value="WHATSAPP">{t('portal.profile.channelOptions.whatsapp')}</SelectItem>
                    <SelectItem value="CHAT">{t('portal.profile.channelOptions.chat')}</SelectItem>
                    <SelectItem value="SMS">{t('portal.profile.channelOptions.sms')}</SelectItem>
                    <SelectItem value="WEB">{t('portal.profile.channelOptions.web')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="profile-locale" className="text-xs font-medium">
                  {t('portal.profile.preferredLocale')}
                </Label>
                <Select
                  value={preferredLocaleValue ?? 'EN'}
                  onValueChange={(val) => setValue('preferredLocale', val as Locale)}
                >
                  <SelectTrigger id="profile-locale" className="mt-1.5 text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EN">{t('portal.profile.localeOptions.en')}</SelectItem>
                    <SelectItem value="AR">{t('portal.profile.localeOptions.ar')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="mt-6 pt-4 border-t flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                {t('portal.profile.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting} className="gap-2 shadow-xs">
                {isSubmitting ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {isSubmitting ? t('portal.profile.saving') : t('portal.profile.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
