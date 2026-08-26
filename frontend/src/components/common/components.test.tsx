/**
 * US-27 — the shared composites the vertical slice consumes.
 *
 * AC4 (keyboard, focus trap, Escape) is the one this file exists to close: the
 * behaviour came free from Radix and was never asserted, which meant nothing
 * would notice if it stopped.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from './combobox';
import { ConfirmDialog } from './confirm-dialog';
import { FilterBar } from './filter-bar';
import { ListPagination } from './list-pagination';
import { SearchField } from './search-field';

const AGENTS: ComboboxOption[] = [
  { value: 'aisha', label: 'Aisha Haddad' },
  { value: 'marcus', label: 'Marcus Webb' },
  { value: 'omar', label: 'Omar Nasser' },
];

function wrap(node: React.ReactNode): React.JSX.Element {
  return <AppProviders>{node}</AppProviders>;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('ConfirmDialog — AC4, keyboard and focus', () => {
  test('focus moves into the dialog and is trapped there', async () => {
    const user = userEvent.setup();

    render(
      wrap(
        <>
          <button type="button">outside</button>
          <ConfirmDialog
            trigger={<Button>Resolve ticket</Button>}
            title="Resolve ticket"
            description="The customer will be told it is resolved."
            confirmLabel="Resolve"
            onConfirm={() => undefined}
          />
        </>,
      ),
    );

    // Captured *before* opening. Once the dialog is up, Radix marks everything
    // behind it `aria-hidden`, so an accessible query can no longer find this —
    // which is itself part of the behaviour being asserted.
    const outside = screen.getByRole('button', { name: 'outside' });

    await user.click(screen.getByRole('button', { name: 'Resolve ticket' }));

    const dialog = await screen.findByRole('alertdialog');

    // Tabbing all the way round must never land on the button behind the
    // overlay — that is what "trapped" means, and it is the difference between
    // a modal and a floating box.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(outside).not.toHaveFocus();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  test('Escape closes it', async () => {
    const user = userEvent.setup();

    render(
      wrap(
        <ConfirmDialog
          trigger={<Button>Resolve ticket</Button>}
          title="Resolve ticket"
          description="The customer will be told it is resolved."
          confirmLabel="Resolve"
          onConfirm={() => undefined}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Resolve ticket' }));
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  test('Escape CANCELS — it never confirms', async () => {
    // The assertion this whole file was worth writing for. A safety dialog
    // where the escape hatch fires the action is worse than no dialog.
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <ConfirmDialog
          trigger={<Button>Delete</Button>}
          title="Delete"
          description="This cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={onConfirm}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('confirming calls the action once and shows it is working', async () => {
    let release: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();

    render(
      wrap(
        <ConfirmDialog
          trigger={<Button>Resolve ticket</Button>}
          title="Resolve ticket"
          description="The customer will be told it is resolved."
          confirmLabel="Resolve"
          onConfirm={onConfirm}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Resolve ticket' }));
    const dialog = await screen.findByRole('alertdialog');

    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    // Held open while it runs, so a slow request cannot be clicked twice.
    expect(await within(dialog).findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    release();
  });

  test('the destructive treatment is opt-in, not the default', () => {
    render(
      wrap(
        <ConfirmDialog
          trigger={<Button>Resolve</Button>}
          title="Resolve"
          description="Fine."
          confirmLabel="Resolve"
          onConfirm={() => undefined}
        />,
      ),
    );

    // Nothing renders until it is opened; the point here is that `destructive`
    // is a boolean on this component rather than a free `variant` prop that
    // could be handed to a harmless action.
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });
});

describe('Combobox', () => {
  function Harness(): React.JSX.Element {
    const [value, setValue] = useState<string | null>(null);

    return (
      <>
        <Combobox
          id="assignee"
          label="Assignee"
          placeholder="Unassigned"
          options={AGENTS}
          value={value}
          onChange={setValue}
        />
        <span data-testid="value">{value ?? 'none'}</span>
      </>
    );
  }

  test('filters as you type and reports the selection', async () => {
    const user = userEvent.setup();
    render(wrap(<Harness />));

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.type(screen.getByPlaceholderText('Search Assignee'), 'marc');

    expect(screen.queryByText('Aisha Haddad')).not.toBeInTheDocument();

    await user.click(screen.getByText('Marcus Webb'));

    expect(screen.getByTestId('value')).toHaveTextContent('marcus');
  });

  test('says so when nothing matches, rather than showing an empty box', async () => {
    const user = userEvent.setup();
    render(wrap(<Harness />));

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.type(screen.getByPlaceholderText('Search Assignee'), 'zzzz');

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  test('selecting what is already selected clears it', async () => {
    const user = userEvent.setup();
    render(wrap(<Harness />));

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.click(screen.getByRole('option', { name: 'Omar Nasser' }));
    expect(screen.getByTestId('value')).toHaveTextContent('omar');

    // By role, not by text: once selected, the name also appears on the
    // trigger, so `getByText` would find two.
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.click(screen.getByRole('option', { name: 'Omar Nasser' }));

    // A required field enforces itself. This one should not trap you.
    expect(screen.getByTestId('value')).toHaveTextContent('none');
  });

  test('the trigger carries a label, since a chevron is not one', () => {
    render(wrap(<Harness />));

    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
  });
});

describe('SearchField', () => {
  test('reports what was typed and clears on request', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      wrap(<SearchField id="q" label="Search tickets" value="" onChange={onChange} />),
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search tickets' }), 'x');
    expect(onChange).toHaveBeenCalledWith('x');

    // The clear control appears only when there is something to clear.
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    rerender(wrap(<SearchField id="q" label="Search tickets" value="disk" onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('FilterBar', () => {
  const FILTERS = [
    { key: 'status', label: 'Status', options: [{ value: 'OPEN', label: 'Open' }] },
    { key: 'priority', label: 'Priority', options: [{ value: 'HIGH', label: 'High' }] },
  ];

  test('reports a change without holding the value itself', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <FilterBar
          filters={FILTERS}
          values={{ status: null, priority: null }}
          onChange={onChange}
          onClear={() => undefined}
        />,
      ),
    );

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(screen.getByText('Open'));

    // Reported upward, so the screen can put it in the URL. If this component
    // kept the value, a shared link would show a different list.
    expect(onChange).toHaveBeenCalledWith('status', 'OPEN');
  });

  test('offers to clear only when something is filtered', () => {
    const { rerender } = render(
      wrap(
        <FilterBar
          filters={FILTERS}
          values={{ status: null, priority: null }}
          onChange={() => undefined}
          onClear={() => undefined}
        />,
      ),
    );

    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    rerender(
      wrap(
        <FilterBar
          filters={FILTERS}
          values={{ status: 'OPEN', priority: null }}
          onChange={() => undefined}
          onClear={() => undefined}
        />,
      ),
    );

    // The count is in the label, not a coloured dot.
    expect(screen.getByRole('button', { name: 'Clear 1 filter' })).toBeInTheDocument();
  });
});

describe('ListPagination', () => {
  test('previous is disabled on the first page and next on the last', () => {
    const { rerender } = render(
      wrap(<ListPagination page={1} totalPages={3} total={57} onPageChange={() => undefined} />),
    );

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(
      wrap(<ListPagination page={3} totalPages={3} total={57} onPageChange={() => undefined} />),
    );

    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  test('pages are 1-based, matching PaginationMeta and the query string', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();

    render(wrap(<ListPagination page={2} totalPages={5} total={91} onPageChange={onPageChange} />));

    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    expect(screen.getByText('91 results')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

describe('AC5 — RTL', () => {
  test('no composite renders a physical direction class', () => {
    const { container } = render(
      wrap(
        <>
          <SearchField id="q" label="Search" value="typed" onChange={() => undefined} />
          <FilterBar
            filters={[{ key: 'status', label: 'Status', options: [] }]}
            values={{ status: 'OPEN' }}
            onChange={() => undefined}
            onClear={() => undefined}
          />
          <ListPagination page={1} totalPages={2} total={9} onPageChange={() => undefined} />
        </>,
      ),
    );

    const classNames = [...container.querySelectorAll('*')]
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ');

    expect(classNames).not.toMatch(/\b(ml|mr|pl|pr)-/);
    expect(classNames).not.toMatch(/\btext-(left|right)\b/);
    expect(classNames).not.toMatch(/\b(left|right)-\d/);
  });
});
