/**
 * US-58 — the manager dashboard.
 *
 * AC1 the KPI row · AC2 the five distributions · AC3 the attention table and its
 * inline actions · AC4 breach emphasis · AC5 the filters governing every query ·
 * AC6 the permission-denied screen.
 *
 * The figures themselves, their scope, and the fact that a foreign department
 * filter returns zeros rather than that department's data are the server's, and
 * are asserted in `backend/src/tickets/team-dashboard.test.ts`.
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
import type { LoginResponse, TeamOverview, Ticket } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { RequirePermission } from '@/features/auth/require-permission';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { TeamDashboardPage } from './team-dashboard-page';

const realAdapter = http.defaults.adapter;

const MANAGER_ID = '01923456-89ab-7cde-8f01-234567890m01';
const AGENT_ID = '01923456-89ab-7cde-8f01-234567890a01';
const BILLING_ID = '01923456-89ab-7cde-8f01-234567890d01';
const BREACHED_ID = '01923456-89ab-7cde-8f01-2345678900t1';
const HEALTHY_ID = '01923456-89ab-7cde-8f01-2345678900t2';

function sessionFor(permissions: Record<string, string[]>, roles: string[]): LoginResponse {
  return {
    accessToken: 'a.test.token',
    expiresIn: 900,
    audience: 'crm-staff',
    user: {
      id: MANAGER_ID,
      email: 'manager@crm.local',
      firstName: 'Layla',
      lastName: 'Mansour',
      locale: 'EN',
      roles,
    },
    permissions: { userId: MANAGER_ID, roles, permissions },
  };
}

const MANAGER = sessionFor(
  {
    'ticket:view': ['TEAM'],
    'ticket:update': ['TEAM'],
    'ticket:assign': ['TEAM'],
    'ticket:escalate': ['TEAM'],
    'report:view': ['TEAM'],
  },
  ['manager'],
);

/** No `report:view` — AC6. */
const AGENT = sessionFor({ 'ticket:view': ['ASSIGNED'] }, ['agent']);

const OVERVIEW: TeamOverview = {
  open: 24,
  unassigned: 5,
  atRisk: 3,
  breached: 2,
  // 42m and 6h 30m, so both branches of the duration formatter are exercised.
  averageResponseSeconds: 2_520,
  averageResolutionSeconds: 23_400,
  byStatus: [
    { key: 'NEW', label: 'NEW', count: 9 },
    { key: 'OPEN', label: 'OPEN', count: 12 },
    { key: 'ESCALATED', label: 'ESCALATED', count: 3 },
  ],
  byPriority: [
    { key: 'URGENT', label: 'URGENT', count: 4 },
    { key: 'HIGH', label: 'HIGH', count: 8 },
  ],
  byDepartment: [
    { key: BILLING_ID, label: 'Billing', count: 18 },
    { key: 'none', label: 'Unassigned', count: 6 },
  ],
  byAgent: [
    { key: AGENT_ID, label: 'Aisha Haddad', count: 11 },
    { key: 'none', label: 'Unassigned', count: 5 },
  ],
  overTime: [
    { key: '2026-08-25', label: '25 Aug', count: 4 },
    { key: '2026-08-26', label: '26 Aug', count: 7 },
  ],
};

const EMPTY_OVERVIEW: TeamOverview = {
  open: 0,
  unassigned: 0,
  atRisk: 0,
  breached: 0,
  averageResponseSeconds: null,
  averageResolutionSeconds: null,
  byStatus: [],
  byPriority: [],
  byDepartment: [],
  byAgent: [],
  overTime: [],
};

function ticketFixture(overrides: Record<string, unknown>): Ticket {
  return {
    id: BREACHED_ID,
    number: 1042,
    subject: 'Refund has not arrived',
    status: 'OPEN',
    priority: 'HIGH',
    channel: 'EMAIL',
    customer: {
      id: '01923456-89ab-7cde-8f01-2345678900c1',
      firstName: 'Nadia',
      lastName: 'Saeed',
      email: 'nadia@example.com',
      companyName: null,
    },
    assigneeId: AGENT_ID,
    assigneeName: 'Aisha Haddad',
    categoryId: null,
    categoryName: null,
    departmentId: BILLING_ID,
    branchId: null,
    tags: [],
    sla: {
      state: 'breach',
      firstRespondedAt: null,
      firstResponseDueAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      resolutionDueAt: new Date(Date.now() - 3_600_000).toISOString(),
      firstResponseBreached: true,
      resolutionBreached: true,
      secondsRemaining: -3_600,
      pausedAt: null,
      pausedMs: 0,
      responseTargetMinutes: 60,
      resolutionTargetMinutes: 480,
    },
    createdAt: new Date(Date.now() - 9 * 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  } as unknown as Ticket;
}

const BREACHED = ticketFixture({});

/** Escalated but not past a target — in the table, without AC4's emphasis. */
const HEALTHY = ticketFixture({
  id: HEALTHY_ID,
  number: 1043,
  subject: 'Cannot reset my password',
  status: 'ESCALATED',
  assigneeId: null,
  assigneeName: null,
  sla: {
    state: 'warn',
    firstRespondedAt: new Date(Date.now() - 3_600_000).toISOString(),
    firstResponseDueAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    resolutionDueAt: new Date(Date.now() + 3_600_000).toISOString(),
    firstResponseBreached: false,
    resolutionBreached: false,
    secondsRemaining: 3_600,
    pausedAt: null,
    pausedMs: 0,
    responseTargetMinutes: 60,
    resolutionTargetMinutes: 480,
  },
});

let sent: InternalAxiosRequestConfig[] = [];

const requested = (): string[] => sent.map((request) => request.url ?? '');

const failure = (config: InternalAxiosRequestConfig): AxiosError =>
  new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, {
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
  } as AxiosResponse);

const ok = (body: unknown, config: InternalAxiosRequestConfig): AxiosResponse =>
  ({ data: body, status: 200, statusText: '', headers: {}, config }) as AxiosResponse;

function respondWith(
  options: {
    overview?: TeamOverview;
    tickets?: Ticket[];
    overviewFails?: boolean;
    escalateFails?: boolean;
  } = {},
): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const url = config.url ?? '';

    if (url.includes('/tickets/team/overview')) {
      return options.overviewFails === true
        ? // A 4xx: the query client retries a 5xx and a network error twice,
          // which is the right policy and would make this a race.
          Promise.reject(failure(config))
        : Promise.resolve(ok({ data: options.overview ?? OVERVIEW }, config));
    }

    if (url.includes('/tickets/assignees')) {
      return Promise.resolve(
        ok(
          {
            data: [
              { id: AGENT_ID, name: 'Aisha Haddad', openTicketCount: 11, isAvailable: true },
              { id: MANAGER_ID, name: 'Layla Mansour', openTicketCount: 2, isAvailable: true },
            ],
          },
          config,
        ),
      );
    }

    if (url.includes('/status')) {
      return options.escalateFails === true
        ? Promise.reject(failure(config))
        : Promise.resolve(ok({ data: { ...BREACHED, status: 'ESCALATED' } }, config));
    }

    const rows = options.tickets ?? [BREACHED, HEALTHY];

    return Promise.resolve(
      ok(
        {
          data: rows,
          pagination: { page: 1, pageSize: 10, total: rows.length, totalPages: 1 },
        },
        config,
      ),
    );
  };

  http.defaults.adapter = adapter;
}

function mount(session: LoginResponse = MANAGER): ReturnType<typeof render> {
  publishSession(session);

  return render(
    <MemoryRouter initialEntries={['/team']}>
      <AppProviders>
        <Routes>
          {/* The real guard from the router, so AC6 tests what ships. */}
          <Route element={<RequirePermission permission="report:view" />}>
            <Route path="/team" element={<TeamDashboardPage />} />
          </Route>
          <Route path="/tickets/:id" element={<div>ticket detail</div>} />
          <Route path="/dashboard" element={<div>my work</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** The row a column assertion is about, found by its subject. */
const rowFor = (subject: string): HTMLElement => {
  const cell = screen.getByText(subject);
  const row = cell.closest('tr');

  if (row === null) {
    throw new Error(`no row for ${subject}`);
  }

  return row;
};

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

describe('AC1 — the team numbers', () => {
  test('the six available figures render with their labels', async () => {
    mount();

    // The section renders with skeletons while pending, so wait for a figure
    // rather than for the region.
    await screen.findByText('Open tickets');

    const kpis = screen.getByRole('region', { name: 'Team numbers' });

    expect(within(kpis).getByText('24')).toBeInTheDocument();
    expect(within(kpis).getByText('Unassigned')).toBeInTheDocument();
    expect(within(kpis).getByText('5')).toBeInTheDocument();
    expect(within(kpis).getByText('SLA at risk')).toBeInTheDocument();
    expect(within(kpis).getByText('3')).toBeInTheDocument();
    expect(within(kpis).getByText('SLA breached')).toBeInTheDocument();
    expect(within(kpis).getByText('2')).toBeInTheDocument();

    // The two averages, as durations rather than raw seconds.
    expect(within(kpis).getByText('42m')).toBeInTheDocument();
    expect(within(kpis).getByText('6h 30m')).toBeInTheDocument();
  });

  test('customer satisfaction is named as pending, never printed as a figure', async () => {
    mount();

    await screen.findByText('Open tickets');

    const kpis = screen.getByRole('region', { name: 'Team numbers' });

    // AC1 asks for it and there is no rating anywhere in the domain — US-88.
    // Said in words, because a "0%" beside "Customer satisfaction" is a lie a
    // manager would act on.
    expect(within(kpis).getByText(/ratings, which are not collected yet/)).toBeInTheDocument();
    expect(within(kpis).queryByText('0%')).not.toBeInTheDocument();
  });

  test('an empty team reads as no data, not as zero minutes', async () => {
    respondWith({ overview: EMPTY_OVERVIEW, tickets: [] });

    mount();

    await screen.findByText('Open tickets');

    const kpis = screen.getByRole('region', { name: 'Team numbers' });

    // Nothing to average is not "instant".
    expect(within(kpis).getAllByText('No data')).toHaveLength(2);
    expect(within(kpis).getAllByText('0').length).toBeGreaterThan(0);

    expect(await screen.findByText('Nothing needs stepping in on')).toBeInTheDocument();
  });

  test('a failed overview does not take the attention table with it', async () => {
    respondWith({ overviewFails: true });

    mount();

    expect(await screen.findByText(/could not load the team numbers/)).toBeInTheDocument();
    // A separate query, so the table still arrives.
    expect(await screen.findByText('Refund has not arrived')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC2 — the distributions
// ---------------------------------------------------------------------------

describe('AC2 — the distributions', () => {
  test('all five render, each labelled and with its figures', async () => {
    mount();

    const charts = await screen.findByRole('region', { name: 'Distributions' });

    await within(charts).findByText('By status');

    for (const title of [
      'Tickets over time (last 14 days)',
      'By status',
      'By priority',
      'By department',
      'Agent workload (open)',
    ]) {
      expect(within(charts).getByText(title)).toBeInTheDocument();
    }

    // Statuses and priorities read in the platform's own words, not the enum.
    expect(within(charts).getByText('Escalated')).toBeInTheDocument();
    expect(within(charts).getByText('Urgent')).toBeInTheDocument();
    expect(within(charts).queryByText('ESCALATED')).not.toBeInTheDocument();

    // A department has a name, and the ticket nobody has filed says so.
    expect(within(charts).getByText('Billing')).toBeInTheDocument();
    expect(within(charts).getByText('No department')).toBeInTheDocument();

    // Every figure is in the DOM as text, which is what makes this readable by a
    // screen reader and printable — see the plan's AC2 note.
    expect(within(charts).getByText('18')).toBeInTheDocument();
    expect(within(charts).getByText('12')).toBeInTheDocument();
    expect(within(charts).getByText('11')).toBeInTheDocument();
  });

  test('no charting canvas — the scope document ruled a charts library out', async () => {
    const { container } = mount();

    await screen.findByText('By status');

    expect(container.querySelector('canvas')).toBeNull();
    // The only SVG on the page is a lucide icon, never a plotted chart.
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC3 — the attention table
// ---------------------------------------------------------------------------

describe('AC3 — tickets requiring attention', () => {
  test('it asks the queue for the attention set, worst first', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const list = requested().find((url) => url.startsWith('/tickets?'));

    expect(list).toContain('attention=true');
    expect(list).toContain('sort=sla');
    expect(list).toContain('dir=asc');
  });

  test('the seven columns the criterion names', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim());

    expect(headers).toEqual([
      'Ticket',
      'Customer',
      'Agent',
      'Priority',
      'SLA',
      'Last update',
      'Actions',
    ]);

    const row = rowFor('Refund has not arrived');

    expect(within(row).getByText('Nadia Saeed')).toBeInTheDocument();
    expect(within(row).getByText('High')).toBeInTheDocument();
  });

  test('reassign, escalate and view are on the row', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const row = rowFor('Refund has not arrived');

    // US-48's control, unchanged — its own permission gate intact.
    expect(within(row).getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Escalate' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open ticket' })).toHaveAttribute(
      'href',
      `/tickets/${BREACHED_ID}`,
    );
  });

  test('escalating goes through the status transition, not a new endpoint', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Refund has not arrived');

    await user.click(
      within(rowFor('Refund has not arrived')).getByRole('button', { name: 'Escalate' }),
    );

    await waitFor(() => {
      expect(sent.some((request) => (request.url ?? '').endsWith('/status'))).toBe(true);
    });

    const patch = sent.find((request) => (request.url ?? '').endsWith('/status'));

    expect(patch?.method?.toLowerCase()).toBe('patch');
    expect(patch?.url).toBe(`/tickets/${BREACHED_ID}/status`);
    expect(JSON.parse(String(patch?.data))).toEqual({ status: 'ESCALATED' });
  });

  test('a ticket already escalated cannot be escalated again', async () => {
    mount();

    await screen.findByText('Cannot reset my password');

    expect(
      within(rowFor('Cannot reset my password')).getByRole('button', { name: 'Escalate' }),
    ).toBeDisabled();
  });

  test('a manager without ticket:escalate is not offered it', async () => {
    mount(
      sessionFor({ 'ticket:view': ['TEAM'], 'ticket:assign': ['TEAM'], 'report:view': ['TEAM'] }, [
        'manager',
      ]),
    );

    await screen.findByText('Refund has not arrived');

    expect(screen.queryByRole('button', { name: 'Escalate' })).not.toBeInTheDocument();
    // The page itself is still theirs.
    expect(screen.getByText('Team overview')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC4 — a breach cannot be missed
// ---------------------------------------------------------------------------

describe('AC4 — breach emphasis', () => {
  test('a breached row is marked in words as well as by colour', async () => {
    mount();

    await screen.findByText('Refund has not arrived');

    const breached = rowFor('Refund has not arrived');

    // The word, which is what the definition of done requires.
    expect(within(breached).getByText('SLA breached')).toBeInTheDocument();
    // And the ground, so it is findable while scanning.
    expect(breached.className).toMatch(/sla-breach/);

    const healthy = rowFor('Cannot reset my password');

    expect(within(healthy).queryByText('SLA breached')).not.toBeInTheDocument();
    expect(healthy.className ?? '').not.toMatch(/sla-breach/);
  });
});

// ---------------------------------------------------------------------------
// AC5 — the filters
// ---------------------------------------------------------------------------

describe('AC5 — the department filter', () => {
  test('its options are the departments the manager can actually see', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Billing');

    await user.click(screen.getByRole('combobox', { name: 'Department' }));

    expect(await screen.findByRole('option', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All I can see' })).toBeInTheDocument();
    // "No department" is a bucket in the distribution, not a filter value.
    expect(screen.queryByRole('option', { name: 'No department' })).not.toBeInTheDocument();
  });

  test('choosing one re-requests every query with it', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Refund has not arrived');

    sent = [];

    await user.click(screen.getByRole('combobox', { name: 'Department' }));
    await user.click(await screen.findByRole('option', { name: 'Billing' }));

    // Both the figures and the table, because AC5 says every KPI, chart and table.
    await waitFor(() => {
      const urls = requested();

      expect(
        urls.some(
          (url) =>
            url.includes('/tickets/team/overview') && url.includes(`departmentId=${BILLING_ID}`),
        ),
      ).toBe(true);
      expect(
        urls.some(
          (url) =>
            url.startsWith('/tickets?') &&
            url.includes('attention=true') &&
            url.includes(`departmentId=${BILLING_ID}`),
        ),
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// AC6 — permission
// ---------------------------------------------------------------------------

describe('AC6 — an agent without management permission', () => {
  test('sees the permission-denied screen, and the page fires no request', async () => {
    mount(AGENT);

    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    // AC4 of US-31: the capability in words, never the permission key.
    expect(screen.getByText(/needs Reporting/)).toBeInTheDocument();
    expect(screen.queryByText('report:view')).not.toBeInTheDocument();

    // Nothing rendered, so nothing asked — the requests would all have 403'd.
    expect(requested().filter((url) => url.includes('/tickets'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = mount();

    expect(await screen.findByText('نظرة عامة على الفريق')).toBeInTheDocument();

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
