import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Combobox } from '@/components/common/combobox';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { FilterBar } from '@/components/common/filter-bar';
import { ListPagination } from '@/components/common/list-pagination';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { PriorityBadge, SlaMeter, slaEdgeClass, StatusBadge } from '@/components/domain/indicators';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { applyBrandAccent, DEFAULT_ACCENT, resetBrandAccent } from '@/lib/branding';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

interface DemoRow {
  id: string;
  subject: string;
  target: number;
  elapsed: number;
  priority: 'LOW' | 'HIGH' | 'URGENT';
}

const DEMO_ROWS: DemoRow[] = [
  {
    id: 'TCK-10482',
    subject: 'Cannot sign in after password change',
    target: 14_400,
    elapsed: 2_400,
    priority: 'LOW',
  },
  {
    id: 'TCK-10488',
    subject: 'Invoice total does not match the order',
    target: 14_400,
    elapsed: 11_400,
    priority: 'HIGH',
  },
  {
    id: 'TCK-10491',
    subject: 'Refund still not received',
    target: 14_400,
    elapsed: 16_800,
    priority: 'URGENT',
  },
];

const DEMO_COLUMNS: ColumnDef<DemoRow>[] = [
  { key: 'id', header: 'Reference', cell: (row) => <span className="tabular">{row.id}</span> },
  { key: 'subject', header: 'Subject', cell: (row) => row.subject, sortable: true },
  { key: 'priority', header: 'Priority', cell: (row) => <PriorityBadge priority={row.priority} /> },
  {
    key: 'sla',
    header: 'SLA',
    sortable: true,
    align: 'end',
    cell: (row) => <SlaMeter targetSeconds={row.target} elapsedSeconds={row.elapsed} />,
  },
];

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
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [sort, setSort] = useState<string | null>('sla');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, string | null>>({
    status: null,
    priority: null,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
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

      {/*
        The composites the vertical slice consumes — US-27, narrowed. Shown as a
        queue toolbar because that is exactly where they are used together.
      */}
      <Section title={t('designSystem.composites')}>
        <div className="bg-paper border-line space-y-4 rounded-md border p-4">
          <FilterBar
            filters={[
              {
                key: 'status',
                label: t('ticket.status.open'),
                options: [
                  { value: 'OPEN', label: t('ticket.status.open') },
                  { value: 'ESCALATED', label: t('ticket.status.escalated') },
                ],
              },
              {
                key: 'priority',
                label: t('ticket.priority.high'),
                options: [
                  { value: 'HIGH', label: t('ticket.priority.high') },
                  { value: 'URGENT', label: t('ticket.priority.urgent') },
                ],
              },
            ]}
            values={filters}
            onChange={(key, value) => {
              setFilters((current) => ({ ...current, [key]: value }));
            }}
            onClear={() => {
              setFilters({ status: null, priority: null });
            }}
            search={{ value: search, onChange: setSearch, label: t('nav.searchPlaceholder') }}
          />

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <Combobox
              id="ds-assignee"
              label={t('designSystem.assignee')}
              placeholder={t('designSystem.unassigned')}
              options={[
                { value: 'aisha', label: 'Aisha Haddad' },
                { value: 'marcus', label: 'Marcus Webb' },
              ]}
              value={assignee}
              onChange={setAssignee}
              className="w-56"
            />

            <ConfirmDialog
              trigger={<Button variant="outline">{t('designSystem.resolveExample')}</Button>}
              title={t('designSystem.resolveExample')}
              description={t('designSystem.resolveExampleBody')}
              confirmLabel={t('designSystem.resolveExample')}
              onConfirm={() => undefined}
            />
          </div>

          <Separator />

          <ListPagination page={2} totalPages={5} total={91} onPageChange={() => undefined} />
        </div>
      </Section>

      <Section title={t('designSystem.dataTable')}>
        {/*
          The table with live sorting and selection. Sorting writes to the URL,
          which is the point of it — a filtered view is something you can send.
        */}
        <DataTable
          columns={DEMO_COLUMNS}
          rows={DEMO_ROWS}
          rowKey={(row) => row.id}
          sort={sort}
          dir={dir}
          onSortChange={(column) => {
            setDir(sort === column && dir === 'asc' ? 'desc' : 'asc');
            setSort(column);
          }}
          selected={selectedRows}
          onSelectedChange={setSelectedRows}
          bulkActions={<Button size="sm">{t('designSystem.assignee')}</Button>}
          emptyTitle={t('states.noResultsTitle')}
          emptyDescription={t('states.noResultsBody')}
        />
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
