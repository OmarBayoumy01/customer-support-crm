/**
 * US-42 — the ticket queue.
 *
 * AC1 columns · AC2 scannability · AC3 filters in the URL, as chips ·
 * AC4 view tabs with live counts · AC5 server-side sorting · AC6 empty states.
 *
 * Plus the Arabic mirror the definition of done requires of anything with a UI.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Ticket, TicketCounts } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { TicketsQueuePage } from './tickets-queue-page';

const realAdapter = http.defaults.adapter;

/** Every request the screen made, so a test can assert what reached the API. */
let sent: InternalAxiosRequestConfig[] = [];

const listCalls = (): InternalAxiosRequestConfig[] =>
  sent.filter((request) => (request.url ?? '').startsWith('/tickets?'));

const HOUR = 3_600_000;

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  const createdAt = new Date(Date.now() - 2 * HOUR).toISOString();

  return {
    id: crypto.randomUUID(),
    number: 1041,
    subject: 'Refund approved but never arrived',
    status: 'OPEN',
    priority: 'HIGH',
    channel: 'EMAIL',
    customer: {
      id: crypto.randomUUID(),
      firstName: 'James',
      lastName: 'Whitfield',
      email: 'j@example.com',
      companyName: 'Northgate Logistics',
    },
    assigneeId: null,
    assigneeName: 'Huda Mansour',
    categoryId: crypto.randomUUID(),
    categoryName: 'Refunds',
    departmentId: null,
    branchId: null,
    tags: [],
    sla: {
      state: 'ok',
      firstRespondedAt: null,
      firstResponseDueAt: new Date(Date.now() + HOUR).toISOString(),
      resolutionDueAt: new Date(Date.now() + 6 * HOUR).toISOString(),
      firstResponseBreached: false,
      resolutionBreached: false,
      secondsRemaining: 6 * 3600,
    },
    createdAt,
    updatedAt: new Date(Date.now() - HOUR).toISOString(),
    ...overrides,
  };
}

const COUNTS: TicketCounts = {
  all: 14,
  unassigned: 3,
  mine: 5,
  escalated: 1,
  breached: 2,
  closed: 7,
};

/** Answers `/tickets/counts` and `/tickets?…` from the given rows. */
function respondWith(rows: Ticket[], total = rows.length): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const url = config.url ?? '';

    const data = url.startsWith('/tickets/counts')
      ? { data: COUNTS }
      : {
          data: rows,
          pagination: {
            page: 1,
            pageSize: 25,
            total,
            totalPages: Math.max(1, Math.ceil(total / 25)),
          },
        };

    const response: AxiosResponse = { data, status: 200, statusText: '', headers: {}, config };

    return Promise.resolve(response);
  };

  http.defaults.adapter = adapter;
}

function renderQueue(initial = '/tickets'): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/tickets" element={<TicketsQueuePage />} />
          <Route path="/tickets/:id" element={<p>ticket detail</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(async () => {
  sent = [];
  await i18n.changeLanguage('en');
  respondWith([ticket()]);
});

afterEach(() => {
  // `exactOptionalPropertyTypes` will not let `undefined` be assigned to an
  // optional property, so the absent case is a delete rather than a write.
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 and AC2 — the row
// ---------------------------------------------------------------------------

describe('AC1 — columns', () => {
  test('every column the criterion names is rendered', async () => {
    renderQueue();

    expect(await screen.findByText('Refund approved but never arrived')).toBeInTheDocument();

    for (const header of [
      'ID',
      'Subject',
      'Customer',
      'Category',
      'Priority',
      'Status',
      'Assignee',
      'SLA',
      'Updated',
    ]) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    }

    // The checkbox column, which is what makes a bulk action possible.
    expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument();

    expect(screen.getByText('#1041')).toBeInTheDocument();
    expect(screen.getByText('Northgate Logistics')).toBeInTheDocument();
    expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.getByText('Huda Mansour')).toBeInTheDocument();
  });

  test('the channel is named for a reader who cannot see the icon', async () => {
    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    // The icon carries no meaning on its own — the definition of done forbids
    // communicating anything by a glyph alone.
    expect(screen.getByText('Email')).toBeInTheDocument();
  });
});

describe('AC2 — scannability', () => {
  test('priority and status are text plus icon, never colour alone', async () => {
    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  test('the SLA cell is a countdown with a state in words', async () => {
    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    const meter = screen.getByRole('meter');

    expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining('On track'));
    expect(within(meter).getByText(/left/)).toBeInTheDocument();
  });

  test('a ticket with no target says so rather than showing an empty cell', async () => {
    respondWith([
      ticket({
        sla: {
          state: 'none',
          firstRespondedAt: null,
          firstResponseDueAt: null,
          resolutionDueAt: null,
          firstResponseBreached: false,
          resolutionBreached: false,
          secondsRemaining: null,
        },
      }),
    ]);

    renderQueue();

    expect(await screen.findByText('No target')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3 — filters
// ---------------------------------------------------------------------------

describe('AC3 — filters', () => {
  test('a filter from the URL reaches the API and appears as a chip', async () => {
    renderQueue('/tickets?priority=URGENT');

    await screen.findByText('Refund approved but never arrived');

    await waitFor(() => {
      expect(listCalls().some((call) => (call.url ?? '').includes('priority=URGENT'))).toBe(true);
    });

    // The chip names the filter as well as the value: "Urgent" alone does not
    // say whether it is a priority or an SLA state.
    const chip = screen.getByRole('button', { name: /Remove Priority filter: Urgent/i });
    expect(chip).toBeInTheDocument();
  });

  test('removing a chip drops the filter from the request', async () => {
    const user = userEvent.setup();

    renderQueue('/tickets?priority=URGENT');

    await screen.findByText('Refund approved but never arrived');

    await user.click(screen.getByRole('button', { name: /Remove Priority filter: Urgent/i }));

    await waitFor(() => {
      const latest = listCalls().at(-1)?.url ?? '';
      expect(latest).not.toContain('priority=URGENT');
    });
  });
});

// ---------------------------------------------------------------------------
// AC4 — view tabs
// ---------------------------------------------------------------------------

describe('AC4 — view tabs', () => {
  test('all six views render, each with its live count', async () => {
    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);

    await waitFor(() => {
      expect(
        within(screen.getByRole('tab', { name: /Breached SLA/ })).getByText('2'),
      ).toBeInTheDocument();
    });

    expect(within(screen.getByRole('tab', { name: /^All/ })).getByText('14')).toBeInTheDocument();
  });

  test('choosing a view filters the list and marks the tab selected', async () => {
    const user = userEvent.setup();

    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    await user.click(screen.getByRole('tab', { name: /Unassigned/ }));

    await waitFor(() => {
      expect(listCalls().some((call) => (call.url ?? '').includes('view=unassigned'))).toBe(true);
    });

    expect(screen.getByRole('tab', { name: /Unassigned/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the view from the URL is the one selected on arrival', async () => {
    renderQueue('/tickets?view=breached');

    await screen.findByText('Refund approved but never arrived');

    expect(screen.getByRole('tab', { name: /Breached SLA/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

// ---------------------------------------------------------------------------
// AC5 — sorting
// ---------------------------------------------------------------------------

describe('AC5 — sorting', () => {
  test('clicking a sortable header re-sorts server-side and marks the column', async () => {
    const user = userEvent.setup();

    renderQueue();

    await screen.findByText('Refund approved but never arrived');

    await user.click(screen.getByRole('button', { name: /Priority/ }));

    await waitFor(() => {
      expect(listCalls().some((call) => (call.url ?? '').includes('sort=priority'))).toBe(true);
    });

    // Announced, not merely drawn — a screen-reader user has to know what order
    // they are reading rows in.
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Priority/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AC6 — empty states
// ---------------------------------------------------------------------------

describe('AC6 — empty states', () => {
  test('an empty queue invites the agent to wait, not to clear filters', async () => {
    respondWith([], 0);

    renderQueue();

    expect(await screen.findByText('Nothing in this queue')).toBeInTheDocument();
  });

  test('a filter that matched nothing offers to clear it', async () => {
    respondWith([], 0);

    renderQueue('/tickets?priority=URGENT');

    // Different problem, different answer: the queue is not empty, the filter
    // is too narrow.
    expect(await screen.findByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(screen.queryByText('Nothing in this queue')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bilingual
// ---------------------------------------------------------------------------

describe('bilingual', () => {
  test('the queue renders in Arabic', async () => {
    await i18n.changeLanguage('ar');

    renderQueue();

    expect(await screen.findByRole('tab', { name: /غير مُسندة/ })).toBeInTheDocument();
    expect(screen.getByText('التذاكر')).toBeInTheDocument();
  });
});
