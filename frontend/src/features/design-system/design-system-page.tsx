import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PriorityBadge, SlaMeter, slaEdgeClass, StatusBadge } from '@/components/domain/indicators';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { applyBrandAccent, DEFAULT_ACCENT, resetBrandAccent } from '@/lib/branding';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

/** One labelled block. Used often enough here to be worth naming. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className={cn('border-line h-12 rounded-md border', className)} />
      {/* Mono, because a token name is code. */}
      <p className="tabular text-meta text-ink-muted">{name}</p>
    </div>
  );
}

/**
 * The living reference for this design system — US-26 and US-27.
 *
 * Inside the app rather than in a separate styleguide, deliberately: a
 * styleguide that is a separate build is a styleguide that goes stale, and the
 * only way to be sure a component still looks right is to render it in the same
 * shell, with the same tokens, in both languages.
 *
 * It doubles as the demonstration of the one rule the system is built on, which
 * is why the thesis is stated at the top rather than buried in a comment.
 */
export function DesignSystemPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-page font-semibold">{t('designSystem.title')}</h1>
        <p className="text-ink-muted">{t('designSystem.subtitle')}</p>
      </header>

      {/*
        The thesis, stated where anyone adding a component will read it. This is
        the constraint the whole system depends on, and a constraint nobody
        knows about is a constraint that lasts one sprint.
      */}
      <div className="bg-paper border-line border-s-brand rounded-md border border-s-4 p-4">
        <p className="text-section font-semibold">{t('designSystem.thesis')}</p>
        <p className="text-ink-muted mt-1">{t('designSystem.thesisBody')}</p>
      </div>

      <Section title={t('designSystem.palette')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch name="--ground" className="bg-ground" />
          <Swatch name="--paper" className="bg-paper" />
          <Swatch name="--line" className="bg-line" />
          <Swatch name="--ink" className="bg-ink" />
          <Swatch name="--accent" className="bg-brand" />
          <Swatch name="--sla-ok" className="bg-sla-ok" />
          <Swatch name="--sla-warn" className="bg-sla-warn" />
          <Swatch name="--sla-breach" className="bg-sla-breach" />
        </div>
      </Section>

      <Section title={t('designSystem.type')}>
        <div className="bg-paper border-line space-y-2 rounded-md border p-4">
          {/* The scale is fixed by AC2: 22 / 16 / 14 / 12, and no more. */}
          <p className="text-page font-semibold">Page title — 22px</p>
          <p className="text-section font-semibold">Section title — 16px</p>
          <p className="text-body">Body — 14px. The default for everything an agent reads.</p>
          <p className="text-meta text-ink-muted">
            Meta — 12px. Labels, table headers, timestamps.
          </p>
          <p className="tabular text-body">TCK-10482 · 2h 15m · 14 open</p>
        </div>
      </Section>

      <Section title={t('designSystem.statuses')}>
        <div className="flex flex-wrap gap-2">
          {TICKET_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.priorities')}>
        <div className="flex flex-wrap gap-2">
          {TICKET_PRIORITIES.map((priority) => (
            <PriorityBadge key={priority} priority={priority} />
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.sla')}>
        {/*
          The signature, shown as it is actually used: a queue you scan down.
          The edge rule is the thing that makes a hundred rows readable at a
          glance, and it mirrors in Arabic because it is an inline-start border.
        */}
        <div className="bg-paper border-line divide-line divide-y overflow-hidden rounded-md border">
          {[
            { id: 'TCK-10482', target: 14_400, elapsed: 2_400, priority: 'LOW' as const },
            { id: 'TCK-10488', target: 14_400, elapsed: 11_400, priority: 'HIGH' as const },
            { id: 'TCK-10491', target: 14_400, elapsed: 16_800, priority: 'URGENT' as const },
          ].map((row) => (
            <div
              key={row.id}
              className={cn(
                'flex items-center gap-4 px-4 py-3',
                slaEdgeClass(row.elapsed / row.target),
              )}
            >
              <span className="tabular text-body w-24 shrink-0">{row.id}</span>
              <PriorityBadge priority={row.priority} />
              <SlaMeter
                targetSeconds={row.target}
                elapsedSeconds={row.elapsed}
                className="ms-auto max-w-48"
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.controls')}>
        <div className="bg-paper border-line space-y-4 rounded-md border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button disabled>Disabled</Button>
          </div>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ds-default">Default</Label>
              <Input id="ds-default" placeholder="Type here" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-error">Error</Label>
              <Input id="ds-error" aria-invalid defaultValue="not-an-email" />
              <p className="text-sla-breach text-meta">Enter a valid email address</p>
            </div>
          </div>
        </div>
      </Section>

      {/* AC4, demonstrated rather than described. */}
      <Section title={t('designSystem.accentLabel')}>
        <div className="bg-paper border-line flex flex-wrap items-end gap-3 rounded-md border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="ds-accent">{t('designSystem.accentLabel')}</Label>
            <Input
              id="ds-accent"
              type="color"
              value={accent}
              className="h-9 w-24 p-1"
              onChange={(event) => {
                setAccent(event.target.value);
                applyBrandAccent(event.target.value);
              }}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setAccent(DEFAULT_ACCENT);
              resetBrandAccent();
            }}
          >
            {t('designSystem.reset')}
          </Button>
          <p className="text-ink-muted text-meta basis-full">{t('designSystem.accentHint')}</p>
        </div>
      </Section>
    </div>
  );
}
