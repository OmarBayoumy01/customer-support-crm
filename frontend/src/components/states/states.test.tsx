/**
 * US-31 — nobody is ever left staring at a blank screen.
 *
 * AC1 skeletons · AC2 empty · AC3 error with recovery · AC4 permission denied ·
 * AC5 offline.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { ApiRequestError } from '@/lib/api-client';
import { EmptyState, NoResultsState } from './empty-state';
import { ErrorState } from './error-state';
import { PermissionDenied } from './permission-denied';
import { DetailSkeleton, ListSkeleton, TableSkeleton } from './skeletons';

function wrap(node: React.ReactNode): React.JSX.Element {
  return (
    <MemoryRouter>
      <AppProviders>{node}</AppProviders>
    </MemoryRouter>
  );
}

/** Drives `navigator.onLine` and fires the matching event, as a browser would. */
function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC1 — skeletons in the shape of the content', () => {
  test('the table skeleton renders the rows it was asked for', () => {
    render(wrap(<TableSkeleton rows={5} />));

    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  test('each skeleton announces itself once, not once per block', () => {
    render(wrap(<ListSkeleton rows={4} />));

    // Four rows, one announcement. Marking every placeholder would have a
    // screen reader narrate twenty grey boxes.
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(4);
    expect(screen.getAllByText('Loading')).toHaveLength(1);
  });

  test('the loading region is marked busy and polite', () => {
    const { container } = render(wrap(<TableSkeleton />));
    const busy = container.querySelector('[aria-busy="true"]');

    expect(busy).not.toBeNull();
    expect(busy).toHaveAttribute('aria-live', 'polite');
  });

  test('the detail skeleton nests a list, so a ticket page loads in its own shape', () => {
    render(wrap(<DetailSkeleton />));

    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
  });
});

describe('AC2 — empty states', () => {
  test('renders a headline, one line, and an action that fires', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      wrap(
        <EmptyState
          title="No tickets yet"
          description="When a customer submits a request it will appear here."
          action={{ label: 'Create a ticket', onClick }}
        />,
      ),
    );

    expect(screen.getByText('No tickets yet')).toBeInTheDocument();
    expect(screen.getByText(/When a customer submits/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create a ticket' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test('the action is optional — not every empty screen has one', () => {
    render(wrap(<EmptyState title="Nothing here" description="Nothing to do about it." />));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('a filtered empty offers the filters back, not "create"', async () => {
    const onClearFilters = vi.fn();
    const user = userEvent.setup();

    render(wrap(<NoResultsState onClearFilters={onClearFilters} />));

    // Offering "Create a ticket" to somebody who filtered a full queue down to
    // nothing answers a question they did not ask.
    expect(screen.getByText('Nothing matches those filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});

describe('AC3 — error with recovery', () => {
  test('retry re-runs the request and does not reload the page', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(wrap(<ErrorState onRetry={onRetry} />));

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // A prop, not `location.reload()`. Reloading throws away everything else
    // the user had loaded — on a ticket workspace, a half-typed reply.
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('the copy neither apologises nor blames the user', () => {
    render(wrap(<ErrorState onRetry={() => undefined} />));

    const text = screen.getByRole('alert').textContent ?? '';

    expect(text).not.toMatch(/sorry/i);
    expect(text).not.toMatch(/you (did|entered|typed)/i);
  });

  test('the request id is shown when there is one', () => {
    render(
      wrap(
        <ErrorState
          error={new ApiRequestError('INTERNAL_ERROR', 'boom', 500, 'req-8f21')}
          onRetry={() => undefined}
        />,
      ),
    );

    // The string a user reads out over the phone, which is why US-7 put it in
    // the body rather than only in a header.
    expect(screen.getByText('req-8f21')).toBeInTheDocument();
  });

  test('no reference is shown when the failure carried none', () => {
    render(wrap(<ErrorState onRetry={() => undefined} />));

    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  test('an offline failure gets different words, since retrying will not help', () => {
    render(wrap(<ErrorState error={new ApiRequestError('NETWORK_ERROR', 'x', 0)} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/no connection/i);
  });
});

describe('AC4 — permission denied', () => {
  test('names the capability in words', () => {
    render(wrap(<PermissionDenied capabilityKey="capability.administration" />));

    expect(screen.getByText(/Administration/)).toBeInTheDocument();
  });

  test('never renders the raw permission key', () => {
    render(wrap(<PermissionDenied capabilityKey="capability.administration" />));

    // The US-23 decision still holds: the vocabulary of the internals does not
    // reach the screen.
    expect(document.body.textContent).not.toContain('user:manage');
  });

  test('offers a way back and a way to ask', () => {
    render(wrap(<PermissionDenied capabilityKey="capability.reporting" />));

    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request access' })).toBeInTheDocument();
  });

  test('falls back to the unnamed screen rather than printing a key', () => {
    render(wrap(<PermissionDenied />));

    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
  });
});

/**
 * The banner is mounted by `AppProviders`, so these render an ordinary child and
 * assert on the one the application itself puts up — which also proves it is
 * wired globally rather than only where somebody remembered it.
 */
describe('AC5 — offline', () => {
  test('nothing renders while online', () => {
    setOnline(true);
    render(wrap(<div />));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('the banner appears when the connection drops', () => {
    render(wrap(<div />));

    setOnline(false);

    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
  });

  test('it clears itself on reconnect, with no reload', () => {
    render(wrap(<div />));

    setOnline(false);
    expect(screen.getByRole('status')).toBeInTheDocument();

    setOnline(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('it is a status, not an alert', () => {
    render(wrap(<div />));
    setOnline(false);

    // `alert` is assertive and would cut across whatever a screen reader is in
    // the middle of. Losing a connection is worth saying, not worth interrupting.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('there is no dismiss control', () => {
    render(wrap(<div />));
    setOnline(false);

    // A banner the user can close is a banner they will close, and then wonder
    // why nothing saves.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('RTL', () => {
  test('no state renders a physical direction class', () => {
    const { container } = render(
      wrap(
        <>
          <TableSkeleton rows={2} />
          <EmptyState title="t" description="d" action={{ label: 'a', onClick: () => undefined }} />
          <ErrorState onRetry={() => undefined} />
        </>,
      ),
    );

    const classNames = [...container.querySelectorAll('*')]
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ');

    expect(classNames).not.toMatch(/\b(ml|mr|pl|pr)-/);
    expect(classNames).not.toMatch(/\btext-(left|right)\b/);
  });
});
