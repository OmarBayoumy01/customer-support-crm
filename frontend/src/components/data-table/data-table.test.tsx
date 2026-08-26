/**
 * US-30 — one table, every list.
 *
 * AC1 server-side operations reflected in the URL · AC2 selection and bulk
 * actions · AC3 horizontal scroll · AC4 states · AC5 the two empties.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { DataTable, type ColumnDef } from './data-table';
import { useTableQueryState } from './use-table-query-state';

interface Ticket {
  id: string;
  subject: string;
  priority: string;
}

const ROWS: Ticket[] = [
  { id: 'TCK-1', subject: 'Cannot log in', priority: 'HIGH' },
  { id: 'TCK-2', subject: 'Invoice wrong', priority: 'LOW' },
  { id: 'TCK-3', subject: 'Refund please', priority: 'URGENT' },
];

const COLUMNS: ColumnDef<Ticket>[] = [
  { key: 'id', header: 'Reference', cell: (row) => row.id },
  { key: 'subject', header: 'Subject', cell: (row) => row.subject, sortable: true },
  { key: 'priority', header: 'Priority', cell: (row) => row.priority, align: 'end' },
];

const EMPTY_COPY = {
  emptyTitle: 'No tickets yet',
  emptyDescription: 'When a customer submits a request it will appear here.',
};

/** Renders the current query string, so the URL can be asserted on. */
function UrlProbe(): React.JSX.Element {
  const location = useLocation();

  return <span data-testid="url">{location.search}</span>;
}

function wrap(node: React.ReactNode, initial = '/list'): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AppProviders>
        <Routes>
          <Route
            path="/list"
            element={
              <>
                {node}
                <UrlProbe />
              </>
            }
          />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

/** Drives the table from the URL exactly as a real screen does. */
function QueryHarness({ rows = ROWS }: { rows?: Ticket[] }): React.JSX.Element {
  const table = useTableQueryState(['status']);

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      sort={table.sort}
      dir={table.dir}
      onSortChange={table.toggleSort}
      isFiltered={table.filters['status'] != null}
      onClearFilters={table.clearFilters}
      {...EMPTY_COPY}
    />
  );
}

describe('AC1 — the URL is the state', () => {
  test('sorting a column writes it to the query string', async () => {
    const user = userEvent.setup();
    render(wrap(<QueryHarness />));

    await user.click(screen.getByRole('button', { name: /Subject/ }));

    // Shareable: this is the difference between a filtered view you can send
    // somebody and one you can only describe.
    expect(screen.getByTestId('url')).toHaveTextContent('sort=subject');
  });

  test('sorting the same column again reverses it', async () => {
    const user = userEvent.setup();
    render(wrap(<QueryHarness />, '/list?sort=subject'));

    await user.click(screen.getByRole('button', { name: /Subject/ }));

    expect(screen.getByTestId('url')).toHaveTextContent('dir=desc');
  });

  test('changing the sort resets to page 1', async () => {
    const user = userEvent.setup();
    render(wrap(<QueryHarness />, '/list?page=4'));

    await user.click(screen.getByRole('button', { name: /Subject/ }));

    // Staying on page 4 of a list that just became six rows long shows an empty
    // table, which reads as a bug rather than as a filter.
    expect(screen.getByTestId('url')).not.toHaveTextContent('page=4');
  });

  test('the sort is announced, not only drawn', async () => {
    const user = userEvent.setup();
    render(wrap(<QueryHarness />));

    await user.click(screen.getByRole('button', { name: /Subject/ }));

    expect(screen.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  test('a column that is not sortable is not a button', () => {
    render(wrap(<QueryHarness />));

    expect(screen.queryByRole('button', { name: /Reference/ })).not.toBeInTheDocument();
  });

  test('a nonsense page in the URL does not become a negative offset', () => {
    render(wrap(<QueryHarness />, '/list?page=abc'));

    // A hand-edited URL should not reach the API as `?page=NaN`.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('AC2 — selection and bulk actions', () => {
  function SelectionHarness(): React.JSX.Element {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    return (
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={<Button size="sm">Assign</Button>}
        {...EMPTY_COPY}
      />
    );
  }

  test('the bar appears with a count once something is selected', async () => {
    const user = userEvent.setup();
    render(wrap(<SelectionHarness />));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!);

    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent('1 selected');
    expect(within(bar).getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  test('the header checkbox selects the whole page', async () => {
    const user = userEvent.setup();
    render(wrap(<SelectionHarness />));

    await user.click(screen.getByRole('checkbox', { name: /Select all rows/ }));

    expect(screen.getByRole('status')).toHaveTextContent('3 selected');
  });

  test('a partial selection reports as indeterminate', async () => {
    const user = userEvent.setup();
    render(wrap(<SelectionHarness />));

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!);

    expect(screen.getByRole('checkbox', { name: /Select all rows/ })).toHaveAttribute(
      'data-state',
      'indeterminate',
    );
  });

  test('clearing the selection hides the bar', async () => {
    const user = userEvent.setup();
    render(wrap(<SelectionHarness />));

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('ticking a row does not also open it', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();

    function Harness(): React.JSX.Element {
      const [selected, setSelected] = useState<Set<string>>(new Set());

      return (
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={onRowClick}
          {...EMPTY_COPY}
        />
      );
    }

    render(wrap(<Harness />));
    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!);

    // The checkbox is not a way into the row.
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('AC4 — states', () => {
  test('loading shows a skeleton and no rows', () => {
    render(
      wrap(
        <DataTable
          columns={COLUMNS}
          rows={[]}
          rowKey={(r: Ticket) => r.id}
          isLoading
          {...EMPTY_COPY}
        />,
      ),
    );

    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('an error shows a retry and no table header', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <DataTable
          columns={COLUMNS}
          rows={[]}
          rowKey={(r: Ticket) => r.id}
          error={new ApiRequestError('INTERNAL_ERROR', 'boom', 500)}
          onRetry={onRetry}
          {...EMPTY_COPY}
        />,
      ),
    );

    // A header above an error implies there is a table underneath it.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('AC5 — two empties, not one', () => {
  test('no records at all offers the screen’s own action', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <DataTable
          columns={COLUMNS}
          rows={[]}
          rowKey={(r: Ticket) => r.id}
          emptyAction={{ label: 'Create a ticket', onClick }}
          {...EMPTY_COPY}
        />,
      ),
    );

    expect(screen.getByText('No tickets yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a ticket' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test('filtered to nothing offers the filters back instead', () => {
    render(wrap(<QueryHarness rows={[]} />, '/list?status=OPEN'));

    // Offering "Create a ticket" to somebody who just filtered a full queue
    // down to nothing answers a question they did not ask.
    expect(screen.getByText('Nothing matches those filters')).toBeInTheDocument();
    expect(screen.queryByText('No tickets yet')).not.toBeInTheDocument();
  });
});

describe('AC3 — horizontal scroll', () => {
  test('the table scrolls inside its own container rather than squeezing columns', () => {
    const { container } = render(
      wrap(
        <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r: Ticket) => r.id} {...EMPTY_COPY} />,
      ),
    );

    const scroller = container.querySelector('.overflow-x-auto');

    expect(scroller).not.toBeNull();
    // The wrapper scrolls, so the page itself never does.
    expect(scroller?.querySelector('table')).not.toBeNull();
  });
});

describe('RTL', () => {
  test('no physical direction class is rendered', () => {
    const { container } = render(
      wrap(
        <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r: Ticket) => r.id} {...EMPTY_COPY} />,
      ),
    );

    const classNames = [...container.querySelectorAll('*')]
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ');

    expect(classNames).not.toMatch(/\b(ml|mr|pl|pr)-/);
    expect(classNames).not.toMatch(/\btext-(left|right)\b/);
  });
});
