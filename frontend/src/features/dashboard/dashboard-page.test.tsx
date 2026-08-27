/**
 * US-55 — the agent dashboard.
 *
 * AC1 the KPI row and its comparison · AC2 the seven columns · AC3 SLA urgency as
 * the default sort · AC4 the row actions · AC5 progressive rendering.
 *
 * The metrics themselves, their scope and their edges are the server's and are
 * asserted in `backend/src/tickets/dashboard.test.ts`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AssignedSummary, LoginResponse, Ticket } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { DashboardPage } from './dashboard-page';

const realAdapter = http.defaults.adapter;

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';
const TICKET_ID = '01923456-89ab-7cde-8f01-2345678900t1';

const SESSION: LoginResponse = {
  accessToken: 'a.test.token',
  expiresIn: 900,
  audience: 'crm-staff',
  user: {
    id: USER_ID,
    email: 'agent@crm.local',
    firstName: 'Aisha',
    lastName: 'Haddad',
    locale: 'EN',
    roles: ['agent'],
  },
  permissions: {
    userId: USER_ID,
    roles: ['agent'],
    permissions: {
      'ticket:view': ['ASSIGNED'],
      'ticket:update': ['ASSIGNED'],
    },
  },
};

const SUMMARY: AssignedSummary = {
  open: { value: 7, previous: 5 },
  pending: { value: 2, previous: null },
  dueSoon: { value: 3, previous: null },
  breached: { value: 1, previous: null },
};

const TICKET = {
  id: TICKET_ID,
  number: 1042,
  subject: 'Refund has not arrived',
  status: 'WAITING_FOR_AGENT',
  priority: 'HIGH',
  channel: 'EMAIL',
  customer: {
    id: '01923456-89ab-7cde-8f01-2345678900c1',
    firstName: 'Nadia',
    lastName: 'Saeed',
    email: 'nadia@example.com',
    companyName: null,
  },
  assigneeId: USER_ID,
  assigneeName: 'Aisha Haddad',
  categoryId: null,
  categoryName: null,
  departmentId: null,
  branchId: null,
  tags: [],
  sla: {
    state: 'warn',
    firstRespondedAt: null,
    firstResponseDueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    resolutionDueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    firstResponseBreached: false,
    resolutionBreached: false,
    secondsRemaining: 7_200,
    pausedAt: null,
    pausedMs: 0,
    responseTargetMinutes: 60,
    resolutionTargetMinutes: 480,
  },
  createdAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
  updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
} as unknown as Ticket;

let sent: InternalAxiosRequestConfig[] = [];

const requested = (): string[] => sent.map((request) => request.url ?? '');

function respondWith(
  options: { tickets?: Ticket[]; summarySlow?: boolean; summaryFails?: boolean } = {},
): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const url = config.url ?? '';

    if (url.includes('/tickets/assigned/summary')) {
      if (options.summaryFails === true) {
        // A 4xx: the query client retries a 5xx and a network error twice with
        // backoff, which is the right policy and would make this a race.
        const failure = {
          data: {
            error: {
              statusCode: 403,
              code: 'FORBIDDEN',
              message: 'refused',
              requestId: 'test-request-id',
              timestamp: new Date().toISOString(),
            },
          },
          status: 403,
          statusText: '',
          headers: {},
          config,
        } as AxiosResponse;

        return Promise.reject(
          new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, failure),
        );
      }

      const answer = {
        data: { data: SUMMARY },
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse;

      // AC5 — held open, so the table can be asserted to render without it.
      return options.summarySlow === true
        ? new Promise<AxiosResponse>((resolve) => setTimeout(() => resolve(answer), 400))
        : Promise.resolve(answer);
    }

    return Promise.resolve({
      data: {
        data: options.tickets ?? [TICKET],
        pagination: {
          page: 1,
          pageSize: 10,
          total: (options.tickets ?? [TICKET]).length,
          totalPages: 1,
        },
      },
      status: 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
}

function mount(): ReturnType<typeof render> {
  publishSession(SESSION);

  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppProviders>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tickets/:id" element={<div>ticket detail</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');
  respondWith();
});

afterEach(() => {
  resetSessionStore();

  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 — the KPI row
// ---------------------------------------------------------------------------

describe('AC1 — the KPI row', () => {
  test('the four figures render with their labels', async () => {
    mount();

    // The section renders immediately with skeletons, so wait for a figure rather
    // than for the region.
    await screen.findByText('Open tickets');

    const kpis = screen.getByRole('region', { name: 'My numbers' });

    for (const label of ['Open tickets', 'Pending', 'Due soon', 'SLA breaches']) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }

    expect(within(kpis).getByText('7')).toBeInTheDocument();
    expect(within(kpis).getByText('2')).toBeInTheDocument();
    expect(within(kpis).getByText('3')).toBeInTheDocument();
    expect(within(kpis).getByText('1')).toBeInTheDocument();
  });

  test('the comparison shows where there is one, and says so where there is not', async () => {
    mount();

    await screen.findByText('Open tickets');

    const kpis = screen.getByRole('region', { name: 'My numbers' });

    // Open: 7 now against 5 a week ago.
    expect(within(kpis).getByText('2 vs last week')).toBeInTheDocument();

    // The other three have no honest past value, so they say so rather than
    // printing a zero that would read as "flat".
    expect(within(kpis).getAllByText('No comparison available')).toHaveLength(3);
  });

  test('a failed KPI query does not take the table with it', async () => {
    respondWith({ summaryFails: true });

    mount();

    expect(await screen.findByText(/could not load your numbers/)).toBeInTheDocument();
    // The table is a separate query, so it still renders.
    expect(await screen.findByText('Refund has not arrived')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC2 — the table
// ---------------------------------------------------------------------------

describe('AC2 — my tickets', () => {
  test('the seven columns the criterion names, and no others', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent?.trim());

    expect(headers).toEqual([
      'ID',
      'Subject',
      'Customer',
      'Priority',
      'Status',
      'SLA',
      'Updated',
      'Actions',
    ]);

    // No staff columns a dashboard of my own work has no use for.
    for (const absent of ['Assignee', 'Department', 'Channel', 'Branch']) {
      expect(headers).not.toContain(absent);
    }
  });

  test('a row carries the id, subject, customer and both indicators', async () => {
    mount();

    expect(await screen.findByText('#1042')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Refund has not arrived' })).toHaveAttribute(
      'href',
      `/tickets/${TICKET_ID}`,
    );
    expect(screen.getByText('Nadia Saeed')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  test('no assigned tickets shows a message rather than an empty grid', async () => {
    respondWith({ tickets: [] });

    mount();

    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument();
    expect(screen.getByText(/most urgent first/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3 — urgency first
// ---------------------------------------------------------------------------

describe('AC3 — urgency-first sorting', () => {
  test('the first request asks for SLA urgency ascending', async () => {
    mount();

    await waitFor(() => {
      expect(requested().some((url) => url.includes('sort=sla') && url.includes('dir=asc'))).toBe(
        true,
      );
    });

    // And it is my own queue, not everybody's.
    expect(requested().some((url) => url.includes('view=mine'))).toBe(true);
  });

  test('the SLA column is marked as the sorted one', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const sla = screen.getAllByRole('columnheader').find((cell) => cell.textContent === 'SLA');

    expect(sla).toHaveAttribute('aria-sort', 'ascending');
  });
});

// ---------------------------------------------------------------------------
// AC4 — act without navigating
// ---------------------------------------------------------------------------

describe('AC4 — row actions', () => {
  test('open, reply, change status and reassign are all on the row', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    // Open — twice over: the subject and an explicit control.
    expect(screen.getByRole('link', { name: 'Open ticket' })).toHaveAttribute(
      'href',
      `/tickets/${TICKET_ID}`,
    );

    // Reply — lands on the composer US-1 built.
    expect(screen.getByRole('link', { name: /Reply/ })).toHaveAttribute(
      'href',
      `/tickets/${TICKET_ID}#reply`,
    );

    // Status — US-47's control, in the row.
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();

    // Reassign — US-48's control. This agent lacks `ticket:assign`, so it renders
    // its own read-only branch, which is that story's AC4 rather than a gap here.
    expect(screen.getByText('Aisha Haddad')).toBeInTheDocument();
  });

  test('changing the status from the row patches that ticket', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Refund has not arrived');

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Waiting for customer/ }));

    await waitFor(() => {
      expect(
        sent.some(
          (request) =>
            request.method?.toLowerCase() === 'patch' &&
            (request.url ?? '') === `/tickets/${TICKET_ID}/status`,
        ),
      ).toBe(true);
    });
  });

  test('there is no snooze control, because there is nowhere to store one', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    // AC4 names snooze; no column, no endpoint and no story owns it. A button
    // that appeared to snooze and did not would be worse than its absence.
    // **This test documents an unmet AC** — replace it when snooze has an owner.
    expect(screen.queryByRole('button', { name: /snooze/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/snooze/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — progressive rendering
// ---------------------------------------------------------------------------

describe('AC5 — progressive rendering', () => {
  test('the table renders while the KPI query is still in flight', async () => {
    respondWith({ summarySlow: true });

    mount();

    // The table arrives first and does not wait for the slower query.
    expect(await screen.findByText('Refund has not arrived')).toBeInTheDocument();
    expect(screen.queryByText('Open tickets')).not.toBeInTheDocument();

    // And the KPIs follow when they are ready.
    expect(await screen.findByText('Open tickets')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = mount();

    expect(await screen.findByText('أعمالي')).toBeInTheDocument();

    for (const element of container.querySelectorAll('*')) {
      const classes = element.className;

      if (typeof classes !== 'string') {
        continue;
      }

      expect(classes).not.toMatch(/\b-?(ml|mr|pl|pr)-/);
      expect(classes).not.toMatch(/\b(left|right)-/);
    }

    await i18n.changeLanguage('en');
  });
});
