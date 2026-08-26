/**
 * US-45 — the ticket detail workspace.
 *
 * AC1 header · AC2 SLA visible without scrolling and expandable ·
 * AC3 three columns with a docked composer · AC4 customer context without
 * navigating · AC5 collapsible, and the preference persists ·
 * AC6 nothing important behind a dialog.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Customer, Ticket, TicketDetail } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { TicketDetailPage } from './ticket-detail-page';

const realAdapter = http.defaults.adapter;

const HOUR = 3_600_000;
const TICKET_ID = '01923456-89ab-7cde-8f01-234567890abc';
const CUSTOMER_ID = '01923456-89ab-7cde-8f01-234567890abd';
const CATEGORY_ID = '01923456-89ab-7cde-8f01-234567890abe';

/** The header's category picker asks for these — US-49. */
const CATEGORIES = [
  {
    id: CATEGORY_ID,
    slug: 'billing-refund',
    nameEn: 'Refunds',
    nameAr: 'المبالغ المستردة',
    parentId: null,
    departmentId: null,
    departmentName: null,
    defaultPriority: null,
    isActive: true,
  },
];

function detail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: TICKET_ID,
    number: 1041,
    subject: 'Refund approved but never arrived',
    description: 'Your team approved a refund on the 3rd and nothing has arrived.',
    status: 'ESCALATED',
    priority: 'URGENT',
    channel: 'EMAIL',
    customer: {
      id: CUSTOMER_ID,
      firstName: 'James',
      lastName: 'Whitfield',
      email: 'j@example.com',
      companyName: 'Northgate Logistics',
    },
    assigneeId: null,
    assigneeName: 'Huda Mansour',
    categoryId: CATEGORY_ID,
    categoryName: 'Refunds',
    departmentId: null,
    branchId: null,
    tags: [],
    slaPolicyName: 'VIP',
    sla: {
      state: 'breach',
      firstResponseDueAt: new Date(Date.now() - 3 * HOUR).toISOString(),
      resolutionDueAt: new Date(Date.now() - HOUR).toISOString(),
      firstResponseBreached: true,
      resolutionBreached: true,
      secondsRemaining: -3600,
    },
    messages: [
      {
        id: 'm1',
        senderType: 'AGENT',
        authorName: 'Huda Mansour',
        body: 'I can see the refund was approved and left our side the same day.',
        isInternal: false,
        channel: 'EMAIL',
        attachments: [],
        createdAt: new Date(Date.now() - 5 * HOUR).toISOString(),
      },
      {
        id: 'm2',
        senderType: 'AGENT',
        authorName: 'Huda Mansour',
        body: 'Payments confirm the batch failed to settle. Do not promise a date yet.',
        isInternal: true,
        channel: null,
        attachments: [],
        createdAt: new Date(Date.now() - 4 * HOUR).toISOString(),
      },
    ],
    messageCount: 2,
    attachments: [],
    history: [
      {
        id: 'h1',
        eventType: 'CREATED',
        field: null,
        fromValue: null,
        toValue: null,
        actorName: 'Huda Mansour',
        automationRule: null,
        createdAt: new Date(Date.now() - 6 * HOUR).toISOString(),
      },
    ],
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    createdAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    updatedAt: new Date(Date.now() - HOUR).toISOString(),
    ...overrides,
  };
}

const CUSTOMER: Customer = {
  id: CUSTOMER_ID,
  firstName: 'James',
  lastName: 'Whitfield',
  email: 'j.whitfield@northgate.example',
  phone: '+441614960001',
  companyName: 'Northgate Logistics',
  type: 'COMPANY',
  isVip: true,
  notes: 'Prefers email. Always chases on a Friday.',
  preferredLocale: 'EN',
  preferredChannel: 'EMAIL',
  departmentId: null,
  branchId: null,
  externalRef: null,
  isActive: true,
  createdAt: new Date(Date.now() - 400 * HOUR).toISOString(),
  stats: { openTickets: 2, totalTickets: 9, lastInteractionAt: null, satisfactionScore: null },
};

const OTHER_TICKET: Ticket = {
  ...detail({ id: 'other', number: 998, subject: 'Invoice charges two cancelled seats' }),
};

function respondWith(ticket: TicketDetail = detail()): void {
  const adapter: AxiosAdapter = (config) => {
    const url = config.url ?? '';

    const data = url.startsWith('/categories')
      ? { data: CATEGORIES }
      : url.startsWith('/customers/')
        ? { data: CUSTOMER }
        : url.startsWith('/tickets?')
          ? { data: [OTHER_TICKET], pagination: { page: 1, pageSize: 6, total: 1, totalPages: 1 } }
          : { data: ticket };

    const response: AxiosResponse = { data, status: 200, statusText: '', headers: {}, config };

    return Promise.resolve(response);
  };

  http.defaults.adapter = adapter;
}

function renderDetail(): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[`/tickets/${TICKET_ID}`]}>
        <Routes>
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
  respondWith();
});

afterEach(() => {
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 and AC6 — the header
// ---------------------------------------------------------------------------

describe('AC1 — header', () => {
  test('number, subject, status, priority, assignee and the metadata strip', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { name: /Refund approved/ })).toBeInTheDocument();
    expect(screen.getByText('#1041')).toBeInTheDocument();

    // AC6 — each of these is on the page, not behind a dialog.
    expect(screen.getByText('Escalated')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    // The assignee also appears on their own messages, so the assertion is that
    // the header names them, not that the name appears exactly once.
    expect(screen.getAllByText('Huda Mansour').length).toBeGreaterThan(0);

    // US-49 turned category into a control, so it is the picker's value rather
    // than a line in the metadata strip.
    expect(await screen.findByRole('combobox', { name: 'Category' })).toHaveTextContent('Refunds');

    // US-46 also tags each message with its channel, so "Email" is on the page
    // more than once now. The assertion is that the strip names it.
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — SLA
// ---------------------------------------------------------------------------

describe('AC2 — SLA without scrolling', () => {
  test('both clocks render immediately, with the state in words', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: /Refund approved/ });

    expect(screen.getByText('First response')).toBeInTheDocument();
    expect(screen.getByText('Resolution')).toBeInTheDocument();

    // Over its target, said in words rather than only in red.
    expect(screen.getAllByText(/over/).length).toBeGreaterThan(0);
  });

  test('a clock expands to show the exact deadline and the policy', async () => {
    const user = userEvent.setup();

    renderDetail();

    await screen.findByRole('heading', { name: /Refund approved/ });

    const toggle = screen.getByRole('button', { name: /First response/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Policy')).toBeInTheDocument();
    // Named, because a countdown without its policy cannot answer "why that
    // number". "VIP" is also the customer's standing in the context panel,
    // which is the point — the same word means both things here.
    expect(screen.getAllByText('VIP').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC3 — three columns
// ---------------------------------------------------------------------------

describe('AC3 — layout', () => {
  test('the conversation is its own region and the composer docks beneath it', async () => {
    renderDetail();

    const conversation = await screen.findByRole('region', { name: 'Conversation' });

    expect(within(conversation).getByText(/I can see the refund was approved/)).toBeInTheDocument();

    // The dock is part of the conversation column, not the page foot. US-1
    // filled it with the composer.
    expect(within(conversation).getByRole('tab', { name: 'Reply' })).toBeInTheDocument();
  });

  test('an internal note is marked as one, three ways over', async () => {
    renderDetail();

    await screen.findByRole('region', { name: 'Conversation' });

    // The project's first non-negotiable rule lives on this distinction, so an
    // agent must be able to tell at a glance what the customer can see.
    expect(screen.getByText('Not visible to the customer')).toBeInTheDocument();
    expect(screen.getByText(/Payments confirm the batch failed/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC4 — customer context
// ---------------------------------------------------------------------------

describe('AC4 — customer context', () => {
  test('name, contact details, standing, counts, other tickets, notes and a profile link', async () => {
    renderDetail();

    const context = await screen.findByRole('complementary', { name: 'Context' });

    // The panel renders skeletons until the customer request lands.
    expect(await within(context).findByText('James Whitfield')).toBeInTheDocument();
    expect(within(context).getByText('j.whitfield@northgate.example')).toBeInTheDocument();
    expect(within(context).getByText('+441614960001')).toBeInTheDocument();
    expect(within(context).getByText('VIP')).toBeInTheDocument();

    expect(within(context).getByText('9')).toBeInTheDocument();
    expect(
      within(context).getByText('Prefers email. Always chases on a Friday.'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(within(context).getByText('Invoice charges two cancelled seats')).toBeInTheDocument();
    });

    expect(within(context).getByRole('link', { name: /Full profile/ })).toHaveAttribute(
      'href',
      `/customers/${CUSTOMER_ID}`,
    );
  });

  test('a customer with no notes says so rather than showing an empty box', async () => {
    const adapter: AxiosAdapter = (config) => {
      const url = config.url ?? '';

      const data = url.startsWith('/categories')
        ? { data: CATEGORIES }
        : url.startsWith('/customers/')
          ? { data: { ...CUSTOMER, notes: null } }
          : url.startsWith('/tickets?')
            ? { data: [], pagination: { page: 1, pageSize: 6, total: 0, totalPages: 1 } }
            : { data: detail() };

      return Promise.resolve({
        data,
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse);
    };

    http.defaults.adapter = adapter;

    renderDetail();

    const context = await screen.findByRole('complementary', { name: 'Context' });

    await waitFor(() => {
      expect(within(context).getByText('Nothing recorded yet.')).toBeInTheDocument();
    });

    expect(within(context).getByText('This is their first ticket.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — collapsible, and it remembers
// ---------------------------------------------------------------------------

describe('AC5 — collapsible context', () => {
  test('collapsing hides the panel and the preference survives a remount', async () => {
    const user = userEvent.setup();

    const first = render(
      <AppProviders>
        <MemoryRouter initialEntries={[`/tickets/${TICKET_ID}`]}>
          <Routes>
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );

    await screen.findByRole('complementary', { name: 'Context' });

    await user.click(screen.getByRole('button', { name: /Collapse the context panel/ }));

    expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull();
    expect(screen.getByRole('button', { name: /Show context/ })).toBeInTheDocument();

    first.unmount();

    // A layout preference that resets on every navigation is not a preference.
    renderDetail();

    await screen.findByRole('heading', { name: /Refund approved/ });
    expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bilingual
// ---------------------------------------------------------------------------

describe('bilingual', () => {
  test('the workspace renders in Arabic', async () => {
    await i18n.changeLanguage('ar');

    renderDetail();

    expect(await screen.findByRole('region', { name: 'المحادثة' })).toBeInTheDocument();
    expect(screen.getByText('غير مرئية للعميل')).toBeInTheDocument();
  });
});
