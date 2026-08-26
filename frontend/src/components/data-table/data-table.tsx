import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState, NoResultsState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { TableSkeleton } from '@/components/states/skeletons';
import { cn } from '@/lib/utils';
import type { SortDirection } from './use-table-query-state';

export interface ColumnDef<TRow> {
  /** Matches the `sort` value the API expects. */
  key: string;
  header: string;
  cell: (row: TRow) => ReactNode;
  sortable?: boolean;
  /** Numbers and dates read better trailing; everything else leads. */
  align?: 'start' | 'end';
  className?: string;
}

export interface DataTableProps<TRow> {
  columns: ColumnDef<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;

  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  sort?: string | null;
  dir?: SortDirection;
  onSortChange?: (column: string) => void;

  /** Held by the caller, so a bulk action can outlive a page change. */
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Rendered in the bulk bar beside the count. */
  bulkActions?: ReactNode;

  onRowClick?: (row: TRow) => void;

  /** Distinguishes "nothing matched" from "nothing exists" — AC5. */
  isFiltered?: boolean;
  onClearFilters?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: { label: string; onClick: () => void };

  className?: string | undefined;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }): React.JSX.Element {
  if (!active) {
    return <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-40" />;
  }

  return dir === 'asc' ? (
    <ArrowUp aria-hidden="true" className="size-3.5" />
  ) : (
    <ArrowDown aria-hidden="true" className="size-3.5" />
  );
}

/**
 * One table for every list — US-30.
 *
 * Props in, callbacks out. It holds no sort, no page and no filters: those live
 * in the URL via `useTableQueryState`, so a filtered view can be shared. The one
 * thing it does not own but does render is the **selection**, which the caller
 * holds so a bulk action can survive a page change if a screen wants that.
 *
 * See the plan for why there is no table library: everything here is
 * server-side, so a client-side table engine would be an adapter around
 * nothing.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  error,
  onRetry,
  sort = null,
  dir = 'asc',
  onSortChange,
  selected,
  onSelectedChange,
  bulkActions,
  onRowClick,
  isFiltered = false,
  onClearFilters,
  emptyTitle,
  emptyDescription,
  emptyAction,
  className,
}: DataTableProps<TRow>): React.JSX.Element {
  const { t } = useTranslation();

  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const pageKeys = rows.map(rowKey);
  const selectedOnPage = pageKeys.filter((key) => selected?.has(key) === true);
  const allOnPage = pageKeys.length > 0 && selectedOnPage.length === pageKeys.length;
  const someOnPage = selectedOnPage.length > 0 && !allOnPage;

  // Exactly one of these, and never a header above an error.
  if (error !== undefined && error !== null) {
    return (
      <ErrorState
        error={error}
        {...(onRetry === undefined ? {} : { onRetry })}
        className={className}
      />
    );
  }

  if (isLoading) {
    return <TableSkeleton />;
  }

  if (rows.length === 0) {
    return isFiltered && onClearFilters !== undefined ? (
      <NoResultsState onClearFilters={onClearFilters} className={className} />
    ) : (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        {...(emptyAction === undefined ? {} : { action: emptyAction })}
        className={className}
      />
    );
  }

  const toggleAll = (): void => {
    const next = new Set(selected);

    for (const key of pageKeys) {
      if (allOnPage) {
        next.delete(key);
      } else {
        next.add(key);
      }
    }

    onSelectedChange?.(next);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* AC2 — appears only when there is a selection, and says how many. */}
      {selectable && selected.size > 0 ? (
        <div
          role="status"
          className="bg-brand-soft border-brand/30 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
        >
          <span className="text-body font-medium">
            {t('table.selectedCount', { count: selected.size })}
          </span>
          <div className="flex items-center gap-2">{bulkActions}</div>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => {
              onSelectedChange(new Set());
            }}
          >
            {t('table.clearSelection')}
          </Button>
        </div>
      ) : null}

      {/*
        AC3 — the wrapper scrolls, not the page, and the table keeps a minimum
        width so columns stay legible rather than being squeezed to fit.
      */}
      <div className="border-line overflow-x-auto rounded-md border">
        <table className="w-full min-w-3xl border-collapse">
          <thead className="bg-secondary/50">
            <tr className="border-line border-b">
              {selectable ? (
                <th scope="col" className="w-10 ps-3">
                  <Checkbox
                    checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label={t('table.selectAll')}
                  />
                </th>
              ) : null}

              {columns.map((column) => {
                const active = sort === column.key;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    // Announced, so a screen-reader user knows the order they
                    // are reading rows in.
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn(
                      'text-meta text-ink-muted px-3 py-2 font-medium',
                      column.align === 'end' ? 'text-end' : 'text-start',
                      column.className,
                    )}
                  >
                    {column.sortable === true && onSortChange !== undefined ? (
                      <button
                        type="button"
                        onClick={() => {
                          onSortChange(column.key);
                        }}
                        className="hover:text-ink inline-flex items-center gap-1"
                      >
                        {column.header}
                        <SortIcon active={active} dir={dir} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-line divide-y">
            {rows.map((row) => {
              const key = rowKey(row);
              const isSelected = selected?.has(key) === true;

              return (
                <tr
                  key={key}
                  data-state={isSelected ? 'selected' : undefined}
                  onClick={
                    onRowClick === undefined
                      ? undefined
                      : () => {
                          onRowClick(row);
                        }
                  }
                  className={cn(
                    'hover:bg-secondary/60 transition-colors',
                    isSelected && 'bg-brand-soft/50',
                    onRowClick !== undefined && 'cursor-pointer',
                  )}
                >
                  {selectable ? (
                    <td
                      className="ps-3"
                      // The checkbox is not a way into the row.
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        aria-label={t('table.selectRow')}
                        onCheckedChange={(checked) => {
                          const next = new Set(selected);

                          if (checked === true) {
                            next.add(key);
                          } else {
                            next.delete(key);
                          }

                          onSelectedChange(next);
                        }}
                      />
                    </td>
                  ) : null}

                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'text-body px-3 py-2.5',
                        column.align === 'end' ? 'text-end' : 'text-start',
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
