import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type SortDirection = 'asc' | 'desc';

export interface TableQueryState {
  page: number;
  sort: string | null;
  dir: SortDirection;
  search: string;
  /** Everything else in the query string, so a screen can add its own filters. */
  filters: Record<string, string | null>;
}

export interface TableQueryActions {
  setPage: (page: number) => void;
  /** Toggles direction when the same column is chosen again. */
  toggleSort: (column: string) => void;
  setSearch: (value: string) => void;
  setFilter: (key: string, value: string | null) => void;
  clearFilters: () => void;
}

/** Reserved, so a filter named `page` cannot collide with paging. */
const RESERVED = new Set(['page', 'sort', 'dir', 'q']);

/**
 * The table's state, held in the URL — US-30, AC1.
 *
 * Not mirrored there. **The query string is the only copy**, which is what makes
 * a filtered view something you can send somebody rather than something you can
 * only describe. It also makes the back button work and a reload keep the view.
 *
 * The case that actually bites: a manager pastes a link into chat and their
 * colleague sees the same list, instead of an unfiltered default and a
 * conversation about which tickets they meant.
 */
export function useTableQueryState(
  filterKeys: readonly string[] = [],
): TableQueryState & TableQueryActions {
  const [params, setParams] = useSearchParams();

  const state = useMemo<TableQueryState>(() => {
    const filters: Record<string, string | null> = {};

    for (const key of filterKeys) {
      filters[key] = params.get(key);
    }

    const page = Number.parseInt(params.get('page') ?? '1', 10);

    return {
      // Guards a hand-edited `?page=abc` or `?page=0`, which would otherwise
      // ask the API for a negative offset.
      page: Number.isFinite(page) && page > 0 ? page : 1,
      sort: params.get('sort'),
      dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
      search: params.get('q') ?? '',
      filters,
    };
  }, [params, filterKeys]);

  /**
   * Writes the given keys, dropping any set to null or empty.
   *
   * `resetPage` is on by default and off only for paging itself: staying on
   * page 4 of a list that just became six rows long shows an empty table, which
   * reads as a bug rather than as a filter.
   */
  const update = useCallback(
    (changes: Record<string, string | null>, resetPage = true): void => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);

          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }

          if (resetPage) {
            next.delete('page');
          }

          return next;
        },
        // Replace, not push: a filter change is a refinement of where you are,
        // not a place you went. Pushing would make the back button walk
        // backwards through every keystroke of a search.
        { replace: true },
      );
    },
    [setParams],
  );

  const setPage = useCallback(
    (page: number): void => {
      update({ page: page <= 1 ? null : String(page) }, false);
    },
    [update],
  );

  const toggleSort = useCallback(
    (column: string): void => {
      const sameColumn = params.get('sort') === column;
      const nextDir = sameColumn && params.get('dir') !== 'desc' ? 'desc' : 'asc';

      update({ sort: column, dir: nextDir === 'asc' ? null : nextDir });
    },
    [params, update],
  );

  const setSearch = useCallback(
    (value: string): void => {
      update({ q: value });
    },
    [update],
  );

  const setFilter = useCallback(
    (key: string, value: string | null): void => {
      if (RESERVED.has(key)) {
        throw new Error(`"${key}" is reserved by the table's own paging and sorting`);
      }

      update({ [key]: value });
    },
    [update],
  );

  const clearFilters = useCallback((): void => {
    const cleared: Record<string, string | null> = { q: null };

    for (const key of filterKeys) {
      cleared[key] = null;
    }

    update(cleared);
  }, [filterKeys, update]);

  return { ...state, setPage, toggleSort, setSearch, setFilter, clearFilters };
}
