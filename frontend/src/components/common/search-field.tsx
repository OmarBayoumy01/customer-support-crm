import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Tied to the input. A magnifying glass is not a label. */
  label: string;
  id: string;
  placeholder?: string;
  className?: string | undefined;
}

/**
 * A search input with a clear control — US-27.
 *
 * **Holds no state and does no debouncing.** Both belong to the screen: the
 * ticket queue keeps its query in the URL so a filtered view can be linked and
 * reloaded, and a component that quietly debounced would put the field and the
 * address bar out of step with each other.
 *
 * The clear button is a real button rather than the browser's `type="search"`
 * cross, which is unlabelled, unstyleable and absent in some browsers.
 */
export function SearchField({
  value,
  onChange,
  label,
  id,
  placeholder,
  className,
}: SearchFieldProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="text-ink-muted pointer-events-none absolute inset-y-0 start-0 my-auto ms-3 size-4"
      />
      <Input
        id={id}
        type="text"
        role="searchbox"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? t('common.search')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        // Padded on both inline sides: the icon leads, the clear control trails,
        // and they swap places with the language.
        className="text-start ps-9 pe-9"
      />
      {value === '' ? null : (
        <button
          type="button"
          aria-label={t('common.clearSearch')}
          onClick={() => {
            onChange('');
          }}
          className="text-ink-muted hover:text-ink absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-md"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
