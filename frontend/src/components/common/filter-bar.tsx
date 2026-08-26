import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Combobox, type ComboboxOption } from './combobox';
import { SearchField } from './search-field';

export interface FilterDefinition {
  /** Matches the key in `values`, and the query-string parameter. */
  key: string;
  label: string;
  options: ComboboxOption[];
}

export interface FilterBarProps {
  filters: FilterDefinition[];
  /** The current selection, keyed by `FilterDefinition.key`. */
  values: Record<string, string | null>;
  onChange: (key: string, value: string | null) => void;
  onClear: () => void;
  search?: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  };
  className?: string | undefined;
}

/**
 * The filter row above a list — US-27.
 *
 * **It owns no state.** It renders what it is given and reports changes upward,
 * so the screen — the ticket queue, in this slice — can keep the filters in the
 * URL where they belong. A filter bar that remembered its own values would
 * eventually disagree with the address bar, and then a shared link would show a
 * different list to the person who received it.
 *
 * The clear control appears only when there is something to clear. A permanently
 * visible "Clear filters" on an unfiltered list is noise that teaches people to
 * ignore that corner of the screen.
 */
export function FilterBar({
  filters,
  values,
  onChange,
  onClear,
  search,
  className,
}: FilterBarProps): React.JSX.Element {
  const { t } = useTranslation();

  const active = filters.filter((filter) => values[filter.key] != null).length;
  const anything = active > 0 || (search?.value ?? '') !== '';

  return (
    <div
      role="search"
      aria-label={t('common.filters')}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {search === undefined ? null : (
        <SearchField
          id="filter-search"
          label={search.label}
          value={search.value}
          onChange={search.onChange}
          className="min-w-56 flex-1"
        />
      )}

      {filters.map((filter) => (
        <Combobox
          key={filter.key}
          id={`filter-${filter.key}`}
          label={filter.label}
          placeholder={filter.label}
          options={filter.options}
          value={values[filter.key] ?? null}
          onChange={(value) => {
            onChange(filter.key, value);
          }}
          className="w-auto min-w-40"
        />
      ))}

      {anything ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5">
          <X aria-hidden="true" className="size-3.5" />
          {/* The count is in the label, not a coloured dot on the button. */}
          {t('common.clearFilters', { count: active })}
        </Button>
      ) : null}
    </div>
  );
}
