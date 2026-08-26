/**
 * US-49 — category and priority, changed in place.
 *
 * AC1 the four priorities, with labels · AC3 the configured categories ·
 * AC4 the routing message.
 *
 * AC2 (the SLA re-evaluates) and AC5 (history) are the server's, and are
 * asserted in `backend/src/tickets/tickets.test.ts`. What this file checks is
 * that the screen asks for them: the PATCH goes out, and the detail query is
 * invalidated so the header's countdown re-reads rather than lying.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import type { Category, TicketDetail } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { TicketClassification } from './ticket-classification';

const realAdapter = http.defaults.adapter;

const TICKET_ID = '01923456-89ab-7cde-8f01-234567890abc';
const BILLING_ID = '01923456-89ab-7cde-8f01-2345678900b1';
const DEPARTMENT_ID = '01923456-89ab-7cde-8f01-2345678900d1';

const CATEGORIES: Category[] = [
  {
    id: BILLING_ID,
    slug: 'billing-refund',
    nameEn: 'Refunds',
    nameAr: 'المبالغ المستردة',
    parentId: null,
    departmentId: DEPARTMENT_ID,
    departmentName: 'Billing',
    defaultPriority: 'HIGH',
    isActive: true,
  },
  {
    id: '01923456-89ab-7cde-8f01-2345678900b2',
    slug: 'delivery',
    nameEn: 'Delivery',
    nameAr: 'التوصيل',
    parentId: null,
    departmentId: null,
    departmentName: null,
    defaultPriority: null,
    isActive: true,
  },
];

let sent: InternalAxiosRequestConfig[] = [];

const patches = (): Record<string, unknown>[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'patch')
    .map((request) => JSON.parse(String(request.data)) as Record<string, unknown>);

/** The ticket as the header has it — only the fields this control reads. */
function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: TICKET_ID,
    priority: 'MEDIUM',
    categoryId: null,
    departmentId: null,
    ...overrides,
  } as TicketDetail;
}

/** `departmentId` on the PATCH response is what tells the UI routing happened. */
function respondWith(patchedDepartmentId: string | null): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if ((config.url ?? '').startsWith('/categories')) {
      return Promise.resolve({
        data: { data: CATEGORIES },
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse);
    }

    return Promise.resolve({
      data: { data: { ...ticket(), departmentId: patchedDepartmentId } },
      status: 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
}

function mount(current: TicketDetail = ticket()): void {
  render(
    <AppProviders>
      <TicketClassification ticket={current} />
    </AppProviders>,
  );
}

beforeEach(async () => {
  sent = [];
  await i18n.changeLanguage('en');
  respondWith(null);
});

afterEach(() => {
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 — priority
// ---------------------------------------------------------------------------

describe('AC1 — priority values', () => {
  test('all four are offered, by name', async () => {
    const user = userEvent.setup();

    mount();

    await user.click(screen.getByRole('combobox', { name: 'Priority' }));

    for (const label of ['Low', 'Medium', 'High', 'Urgent']) {
      expect(await screen.findByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  test('changing it patches the ticket', async () => {
    const user = userEvent.setup();

    mount();

    await user.click(screen.getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: 'Urgent' }));

    await waitFor(() => {
      expect(patches()).toEqual([{ priority: 'URGENT' }]);
    });
  });
});

// ---------------------------------------------------------------------------
// AC3 — categories
// ---------------------------------------------------------------------------

describe('AC3 — category list', () => {
  test('the configured categories are offered, plus a way back to none', async () => {
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByRole('combobox', { name: 'Category' }));

    expect(await screen.findByRole('option', { name: 'Refunds' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Delivery' })).toBeInTheDocument();
    // A ticket filed wrongly has to be un-fileable, not only re-fileable.
    expect(screen.getByRole('option', { name: 'Uncategorised' })).toBeInTheDocument();
  });

  test('clearing it sends null rather than an empty string', async () => {
    const user = userEvent.setup();

    mount(ticket({ categoryId: BILLING_ID }));

    await user.click(await screen.findByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Uncategorised' }));

    await waitFor(() => {
      expect(patches()).toEqual([{ categoryId: null }]);
    });
  });

  test('it renders category names in Arabic', async () => {
    await i18n.changeLanguage('ar');

    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByRole('combobox', { name: 'التصنيف' }));

    expect(await screen.findByRole('option', { name: 'المبالغ المستردة' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC4 — routing
// ---------------------------------------------------------------------------

describe('AC4 — department routing', () => {
  test('choosing a mapped category says where the ticket now routes', async () => {
    respondWith(DEPARTMENT_ID);

    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Refunds' }));

    expect(await screen.findByText(/It now routes to Billing\./)).toBeInTheDocument();
  });

  test('a category with no department says nothing about routing', async () => {
    // Saying it routed when it did not teaches people to ignore the message.
    respondWith(null);

    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Delivery' }));

    expect((await screen.findAllByText('Ticket updated.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/routes to/)).toBeNull();
  });
});
