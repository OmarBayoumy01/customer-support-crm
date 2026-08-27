/**
 * US-47 — the status control.
 *
 * AC1 all seven statuses · AC2 only valid moves are selectable · AC3 the resolve
 * confirmation · AC6 one label per status.
 *
 * AC4 (the SLA clock and the history entry) and AC5 (reopening) are the
 * server's, and are asserted in `backend/src/tickets/tickets.test.ts`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import type { EffectivePermissions, LoginResponse, TicketDetail } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { TicketStatusControl } from './ticket-status';

const realAdapter = http.defaults.adapter;

const TICKET_ID = '01923456-89ab-7cde-8f01-234567890abc';
const USER_ID = '01923456-89ab-7cde-8f01-234567890a01';

let sent: InternalAxiosRequestConfig[] = [];

const patches = (): Record<string, unknown>[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'patch')
    .map((request) => JSON.parse(String(request.data)) as Record<string, unknown>);

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: TICKET_ID,
    status: 'OPEN',
    sla: { firstRespondedAt: null },
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
      email: 'agent@crm.local',
      firstName: 'Aisha',
      lastName: 'Haddad',
      locale: 'EN',
      roles: ['agent'],
    },
    permissions: { userId: USER_ID, roles: ['agent'], permissions },
  };
}

const FULL = sessionWith({
  'ticket:view': ['ALL'],
  'ticket:update': ['ALL'],
  'ticket:close': ['ALL'],
  'ticket:escalate': ['ALL'],
});
/** Can update, cannot resolve or close — the grant the catalogue separates. */
const NO_CLOSE = sessionWith({ 'ticket:view': ['ALL'], 'ticket:update': ['ALL'] });

function mount(session: LoginResponse, current: TicketDetail = ticket()): void {
  publishSession(session);

  render(
    <AppProviders>
      <TicketStatusControl ticket={current} />
    </AppProviders>,
  );
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');

  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    return Promise.resolve({
      data: { data: { ...ticket(), status: 'RESOLVED' } },
      status: 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
});

afterEach(() => {
  resetSessionStore();

  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

describe('AC1 — the status set', () => {
  test('all seven are offered, by name', async () => {
    const user = userEvent.setup();

    mount(FULL);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));

    for (const label of [
      'New',
      'Open',
      'Pending customer',
      'Pending internal',
      'Escalated',
      'Resolved',
      'Closed',
    ]) {
      // AC6 — the label comes from STATUS_PRESENTATION, the same source the
      // badge in the queue reads.
      expect(await screen.findByRole('option', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});

describe('AC2 — valid transitions', () => {
  test('a legal move patches the status endpoint', async () => {
    const user = userEvent.setup();

    mount(FULL);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Pending customer/ }));

    await waitFor(() => {
      expect(patches()).toEqual([{ status: 'PENDING_CUSTOMER' }]);
    });
  });

  test('a move the state machine forbids is disabled, with the reason in words', async () => {
    const user = userEvent.setup();

    mount(FULL, ticket({ status: 'RESOLVED' }));

    await user.click(screen.getByRole('combobox', { name: 'Status' }));

    // RESOLVED goes to OPEN or CLOSED. Listed but not selectable, so the agent
    // learns the shape of the lifecycle rather than wondering where it went.
    const pending = await screen.findByRole('option', { name: /Pending customer/ });

    expect(pending).toHaveAttribute('aria-disabled', 'true');
    expect(pending).toHaveTextContent('Not available from here');

    await user.click(pending);

    await waitFor(() => {
      expect(patches()).toEqual([]);
    });
  });

  test('a move the caller lacks the permission for is disabled', async () => {
    const user = userEvent.setup();

    mount(NO_CLOSE);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));

    const resolved = await screen.findByRole('option', { name: /Resolved/ });

    // A convenience, not a boundary — the server refuses it too, and there is a
    // backend test saying so.
    expect(resolved).toHaveAttribute('aria-disabled', 'true');
    expect(resolved).toHaveTextContent('Needs permission');
  });
});

describe('AC3 — resolution requires substance', () => {
  test('resolving with no agent reply asks before saving', async () => {
    const user = userEvent.setup();

    mount(FULL, ticket({ sla: { firstRespondedAt: null } } as Partial<TicketDetail>));

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Resolved/ }));

    expect(await screen.findByText(/Resolve without replying\?/)).toBeInTheDocument();

    // Nothing has been sent yet — the dialog is the confirmation, not a notice
    // after the fact.
    expect(patches()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Resolve anyway' }));

    await waitFor(() => {
      expect(patches()).toEqual([{ status: 'RESOLVED' }]);
    });
  });

  test('dismissing it sends nothing', async () => {
    const user = userEvent.setup();

    mount(FULL);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Resolved/ }));

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(patches()).toEqual([]);
    });
  });

  test('resolving a ticket that has a reply saves immediately', async () => {
    const user = userEvent.setup();

    mount(
      FULL,
      ticket({ sla: { firstRespondedAt: '2026-08-20T09:00:00.000Z' } } as Partial<TicketDetail>),
    );

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Resolved/ }));

    await waitFor(() => {
      expect(patches()).toEqual([{ status: 'RESOLVED' }]);
    });

    expect(screen.queryByText(/Resolve without replying\?/)).not.toBeInTheDocument();
  });
});

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const user = userEvent.setup();

    publishSession(FULL);

    const { container } = render(
      <AppProviders>
        <TicketStatusControl ticket={ticket()} />
      </AppProviders>,
    );

    await user.click(screen.getByRole('combobox', { name: 'الحالة' }));

    expect(await screen.findByRole('option', { name: /تم حلها/ })).toBeInTheDocument();

    for (const element of container.querySelectorAll('*')) {
      const classes = element.className;

      if (typeof classes !== 'string') {
        continue;
      }

      expect(classes).not.toMatch(/\b-?(ml|mr|pl|pr)-/);
      expect(classes).not.toMatch(/\b(left|right)-/);
    }
  });
});
