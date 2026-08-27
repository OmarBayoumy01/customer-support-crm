/**
 * US-48 — the assignee control.
 *
 * AC2 the workload beside each name · AC4 read-only without the permission ·
 * AC5 an unavailable agent is marked and cannot be chosen · AC3 unassigning.
 *
 * AC1's history entry and AC6's handover context are the server's, and are
 * asserted in `backend/src/tickets/tickets.test.ts`. What this file checks is
 * that the screen asks for the right thing and never offers an action that would
 * be refused.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import type {
  AssignableAgent,
  EffectivePermissions,
  LoginResponse,
  TicketDetail,
} from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { TicketAssignee } from './ticket-assignee';

const realAdapter = http.defaults.adapter;

const TICKET_ID = '01923456-89ab-7cde-8f01-234567890abc';
const USER_ID = '01923456-89ab-7cde-8f01-2345678900u1';
const LAYLA_ID = '01923456-89ab-7cde-8f01-2345678900a1';
const OMAR_ID = '01923456-89ab-7cde-8f01-2345678900a2';
const RETIRED_ID = '01923456-89ab-7cde-8f01-2345678900a3';

const AGENTS: AssignableAgent[] = [
  {
    id: LAYLA_ID,
    name: 'Layla Haddad',
    email: 'layla@crm.local',
    departmentName: 'Support',
    openTicketCount: 7,
    isAvailable: true,
  },
  {
    id: OMAR_ID,
    name: 'Omar Nasser',
    email: 'omar@crm.local',
    departmentName: 'Support',
    openTicketCount: 2,
    isAvailable: true,
  },
  {
    id: RETIRED_ID,
    name: 'Rana Tawfiq',
    email: 'rana@crm.local',
    departmentName: 'Support',
    openTicketCount: 0,
    isAvailable: false,
  },
];

let sent: InternalAxiosRequestConfig[] = [];

const patches = (): { url: string; body: Record<string, unknown> }[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'patch')
    .map((request) => ({
      url: request.url ?? '',
      body: JSON.parse(String(request.data)) as Record<string, unknown>,
    }));

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: TICKET_ID,
    assigneeId: null,
    assigneeName: null,
    ...overrides,
  } as TicketDetail;
}

function sessionWith(permissions: EffectivePermissions['permissions']): LoginResponse {
  return {
    accessToken: 'a.test.token',
    expiresIn: 900,
    audience: 'crm-staff',
    user: {
      id: USER_ID,
      email: 'manager@crm.local',
      firstName: 'Mona',
      lastName: 'Fahmy',
      locale: 'EN',
      roles: ['manager'],
    },
    permissions: { userId: USER_ID, roles: ['manager'], permissions },
  };
}

const MANAGER = sessionWith({ 'ticket:view': ['ALL'], 'ticket:assign': ['TEAM'] });
/** Holds `ticket:update` and not `ticket:assign` — the whole of AC4. */
const AGENT = sessionWith({ 'ticket:view': ['ASSIGNED'], 'ticket:update': ['ASSIGNED'] });

/** The assignment response, which is what tells the UI what happened. */
function respondWith(assigneeName: string | null): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if ((config.url ?? '').includes('/assignees')) {
      return Promise.resolve({
        data: { data: AGENTS },
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse);
    }

    return Promise.resolve({
      data: {
        data: {
          ...ticket(),
          assigneeName,
          assigneeId: assigneeName === null ? null : OMAR_ID,
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

function mount(
  session: LoginResponse,
  current: TicketDetail = ticket(),
): ReturnType<typeof render> {
  // Seeded before render: AuthProvider initialises from the store, and a
  // publish during render would reach a provider that has not subscribed yet.
  publishSession(session);

  return render(
    <AppProviders>
      <TicketAssignee ticket={current} />
    </AppProviders>,
  );
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');
  respondWith('Omar Nasser');
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
// AC2 — workload visibility
// ---------------------------------------------------------------------------

describe('AC2 — workload visibility', () => {
  test('each agent shows their open ticket count, in words', async () => {
    const user = userEvent.setup();

    mount(MANAGER);

    await user.click(await screen.findByRole('combobox', { name: 'Assignee' }));

    const layla = await screen.findByRole('option', { name: /Layla Haddad/ });

    // The number, not a colour — "avoid overloading one person" is a comparison
    // between two figures, which no hue can carry.
    expect(layla).toHaveTextContent('7 open');
    expect(await screen.findByRole('option', { name: /Omar Nasser/ })).toHaveTextContent('2 open');
  });

  test('choosing somebody patches the assignee endpoint', async () => {
    const user = userEvent.setup();

    mount(MANAGER);

    await user.click(await screen.findByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: /Omar Nasser/ }));

    await waitFor(() => {
      // Its own endpoint, not `PATCH /tickets/:id` — that route no longer
      // accepts an assignee, and the guard is the reason.
      expect(patches()).toEqual([
        { url: `/tickets/${TICKET_ID}/assignee`, body: { assigneeId: OMAR_ID } },
      ]);
    });
  });

  test('it confirms the assignment by name', async () => {
    const user = userEvent.setup();

    mount(MANAGER);

    await user.click(await screen.findByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: /Omar Nasser/ }));

    expect(await screen.findByText(/Assigned to Omar Nasser\./)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3 — unassign
// ---------------------------------------------------------------------------

describe('AC3 — unassign', () => {
  test('re-selecting the current assignee clears it, and says so', async () => {
    respondWith(null);

    const user = userEvent.setup();

    mount(MANAGER, ticket({ assigneeId: OMAR_ID, assigneeName: 'Omar Nasser' }));

    await user.click(await screen.findByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: /Omar Nasser/ }));

    await waitFor(() => {
      expect(patches()).toEqual([
        { url: `/tickets/${TICKET_ID}/assignee`, body: { assigneeId: null } },
      ]);
    });

    expect(await screen.findByText(/back in the Unassigned queue/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC4 — permission boundary
// ---------------------------------------------------------------------------

describe('AC4 — permission boundary', () => {
  test('without ticket:assign the control is read-only', async () => {
    mount(AGENT, ticket({ assigneeId: OMAR_ID, assigneeName: 'Omar Nasser' }));

    // The value still renders — a disabled control invites a click and teaches
    // nothing, while the badge reads correctly.
    expect(await screen.findByText('Omar Nasser')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument();
  });

  test('and the candidate list is never requested', async () => {
    mount(AGENT);

    await screen.findByText('Unassigned');

    // A request guarded by `ticket:assign` fired for somebody without it is a
    // guaranteed 403 in the console of every agent who opens a ticket.
    expect(sent.some((request) => (request.url ?? '').includes('/assignees'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC5 — availability
// ---------------------------------------------------------------------------

describe('AC5 — availability', () => {
  test('an unavailable agent is marked in words and cannot be chosen', async () => {
    const user = userEvent.setup();

    mount(MANAGER);

    await user.click(await screen.findByRole('combobox', { name: 'Assignee' }));

    const retired = await screen.findByRole('option', { name: /Rana Tawfiq/ });

    expect(retired).toHaveTextContent('Unavailable');
    expect(retired).toHaveAttribute('aria-disabled', 'true');

    await user.click(retired);

    // Not offered by default means not selectable, so nothing goes out.
    await waitFor(() => {
      expect(patches()).toEqual([]);
    });
  });

  test('an assignee who is no longer a candidate is still named', async () => {
    mount(MANAGER, ticket({ assigneeId: RETIRED_ID, assigneeName: 'Rana Tawfiq' }));

    // Otherwise a ticket that *is* assigned renders as though it were not.
    expect(await screen.findByText('Rana Tawfiq')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The definition of done — Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const user = userEvent.setup();

    const { container } = mount(MANAGER);

    await user.click(await screen.findByRole('combobox', { name: 'المسؤول' }));

    expect(await screen.findByRole('option', { name: /Layla Haddad/ })).toBeInTheDocument();

    for (const element of container.querySelectorAll('*')) {
      const classes = element.className;

      if (typeof classes !== 'string') {
        continue;
      }

      // `ms/me`, `ps/pe`, `start/end` — never `ml/mr`, `pl/pr`, `left/right`.
      expect(classes).not.toMatch(/\b-?(ml|mr|pl|pr)-/);
      expect(classes).not.toMatch(/\b(left|right)-/);
    }
  });
});
