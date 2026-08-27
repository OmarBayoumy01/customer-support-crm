import { useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Rendered beside the label — an avatar, a status dot, a count. */
  adornment?: ReactNode;
  /**
   * Rendered at the far end of the row — US-48, AC2.
   *
   * For the fact that qualifies the choice rather than identifying it: an
   * agent's open ticket count, or why they cannot be picked. Kept apart from
   * `adornment` so it can be aligned to the trailing edge, which mirrors
   * correctly in Arabic.
   */
  meta?: ReactNode;
  /**
   * Visible but not selectable — US-48, AC5.
   *
   * "Marked unavailable and not offered by default" is two things, and removing
   * the row satisfies neither: a ticket already assigned to somebody since
   * deactivated still has to show their name. Pair this with `meta` saying why.
   */
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown when nothing is selected. */
  placeholder: string;
  /**
   * Required, and tied to the trigger.
   *
   * A combobox is a button pretending to be a field, so without this a screen
   * reader announces "button, collapsed" and nothing about what it selects.
   */
  label: string;
  id: string;
  disabled?: boolean;
  className?: string | undefined;
}

/**
 * Pick one thing from a list, with typing to narrow it — US-27.
 *
 * Single-select on purpose: nothing in the vertical slice picks more than one
 * assignee, category or customer, and a multi-select API built without a
 * consumer is an API built by guessing.
 *
 * Filtering is client-side over `options`. The first list long enough to need
 * the server is the customer picker, and that arrives with US-41 — at which
 * point this grows a `onSearch` prop rather than being replaced.
 *
 * Consumers here: US-48 assignee, US-49 category, US-41 customer.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  label,
  id,
  disabled = false,
  className,
}: ComboboxProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          // `justify-between` plus `text-start` rather than centring: the label
          // reads from the same edge as everything else in the form.
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate text-start', selected === undefined && 'text-ink-muted')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('common.searchIn', { what: label })} />
          <CommandList>
            <CommandEmpty>{t('common.noMatches')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  disabled={option.disabled ?? false}
                  onSelect={() => {
                    // `disabled` stops the pointer, but a keyboard Enter can
                    // still reach here in some Command versions. Refusing in
                    // both places is cheaper than depending on which.
                    if (option.disabled === true) {
                      return;
                    }

                    // Selecting what is already selected clears it. A required
                    // field enforces itself; this one should not trap you.
                    onChange(option.value === value ? null : option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'me-2 size-4',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {option.adornment}
                  <span className="truncate">{option.label}</span>
                  {option.meta === undefined ? null : (
                    // `ms-auto` rather than a margin on one side: the trailing
                    // edge is the right in English and the left in Arabic.
                    <span className="text-meta text-ink-muted ms-auto ps-2 shrink-0">
                      {option.meta}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
