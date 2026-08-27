/**
 * US-86 — the submit form.
 *
 * AC1 the fields it asks for · AC2 plain urgency, no priority names anywhere ·
 * AC4 the confirmation · AC5 friendly validation.
 *
 * The server half — ownership from the token, the urgency mapping, the category
 * validation — is asserted in `backend/src/portal/portal-submit.test.ts`.
 *
 * **AC3 (article deflection) and AC6 (attachment limits) are unmet and untested.**
 * The knowledge base is all of P09 and object storage is US-51, both cut from the
 * MVP. There is no fake article list and no file picker that cannot upload.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { LoginResponse, PortalCategory, PortalTicketDetail } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { PortalSubmitPage } from './portal-submit-page';

const realAdapter = http.defaults.adapter;

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';
const CATEGORY_ID = '01923456-89ab-7cde-8f01-2345678900c1';

const SESSION: LoginResponse = {
  accessToken: 'a.test.token',
  expiresIn: 900,
  audience: 'crm-portal',
  user: {
    id: USER_ID,
    email: 'nadia@example.com',
    firstName: 'Nadia',
    lastName: 'Saeed',
    locale: 'EN',
    roles: ['customer'],
  },
  permissions: { userId: USER_ID, roles: ['customer'], permissions: {} },
};

const CATEGORIES: PortalCategory[] = [{ id: CATEGORY_ID, name: 'Billing' }];

const CREATED: PortalTicketDetail = {
  id: '01923456-89ab-7cde-8f01-2345678900t1',
  number: 1042,
  subject: 'My refund has not arrived',
  status: 'NEW',
  categoryName: 'Billing',
  createdAt: '2026-08-27T10:00:00.000Z',
  updatedAt: '2026-08-27T10:00:00.000Z',
  description: 'The bank says nothing is pending.',
  assigneeFirstName: null,
  messages: [],
  messageCount: 0,
  resolvedAt: null,
  events: [],
};

let sent: InternalAxiosRequestConfig[] = [];

const submissions = (): Record<string, unknown>[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'post')
    .map((request) => JSON.parse(String(request.data)) as Record<string, unknown>);

function respondWith(status = 201): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if ((config.url ?? '').includes('/portal/categories')) {
      return Promise.resolve({
        data: { data: CATEGORIES },
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse);
    }

    if (status >= 400) {
      const response = {
        data: {
          error: {
            statusCode: status,
            code: 'UNPROCESSABLE',
            message: 'refused',
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        },
        status,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse;

      return Promise.reject(
        new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response),
      );
    }

    return Promise.resolve({
      data: { data: CREATED },
      status,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
}

function mount(): void {
  publishSession(SESSION);

  render(
    <MemoryRouter initialEntries={['/portal/new']}>
      <AppProviders>
        <Routes>
          <Route path="/portal/new" element={<PortalSubmitPage />} />
          <Route path="/portal" element={<div>portal home</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** Fills the form in the way a customer would. */
async function fillAndSend(overrides: { subject?: string | null } = {}): Promise<void> {
  const user = userEvent.setup();

  if (overrides.subject !== null) {
    await user.type(
      screen.getByLabelText('What do you need help with?'),
      overrides.subject ?? 'My refund has not arrived',
    );
  }

  await user.click(screen.getByRole('combobox', { name: 'How urgent is it?' }));
  await user.click(await screen.findByRole('option', { name: 'I need help soon' }));

  await user.type(screen.getByLabelText('Tell us more'), 'The bank says nothing is pending.');

  await user.click(screen.getByRole('button', { name: 'Send request' }));
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');
  respondWith(201);
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
// AC1 — the fields
// ---------------------------------------------------------------------------

describe('AC1 — minimal fields', () => {
  test('it asks for subject, category, urgency, description and contact method', () => {
    mount();

    expect(screen.getByLabelText('What do you need help with?')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'What is it about?' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'How urgent is it?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tell us more')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'How should we reach you?' })).toBeInTheDocument();

    // AC6 and AC1's attachments are unmet: object storage is US-51. A picker
    // that cannot upload would be worse than none, so there is not one.
    expect(screen.queryByLabelText(/attach/i)).not.toBeInTheDocument();
  });

  test('the categories come from the portal endpoint, and "not sure" is an option', async () => {
    const user = userEvent.setup();

    mount();

    await user.click(screen.getByRole('combobox', { name: 'What is it about?' }));

    expect(await screen.findByRole('option', { name: 'Billing' })).toBeInTheDocument();
    // A customer who does not know the category should not be stuck.
    expect(screen.getByRole('option', { name: 'I am not sure' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC2 — plain urgency
// ---------------------------------------------------------------------------

describe('AC2 — urgency in plain language', () => {
  test('the options are plain descriptions, and no priority name is on screen', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <MemoryRouter initialEntries={['/portal/new']}>
        <AppProviders>
          <Routes>
            <Route path="/portal/new" element={<PortalSubmitPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('combobox', { name: 'How urgent is it?' }));

    expect(await screen.findByRole('option', { name: 'Whenever you can get to it' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'I need help soon' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'It is stopping me working' })).toBeVisible();

    // The internal vocabulary appears nowhere — including the tightest priority,
    // which the portal cannot reach at all.
    for (const internal of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      expect(container.textContent ?? '').not.toContain(internal);
    }
  });

  test('it posts the plain value, never a priority', async () => {
    mount();

    await fillAndSend();

    await waitFor(() => {
      expect(submissions()).toHaveLength(1);
    });

    const body = submissions()[0]!;

    expect(body.urgency).toBe('soon');
    // Nor anything the customer should not be choosing.
    expect('priority' in body).toBe(false);
    expect('customerId' in body).toBe(false);
    expect('channel' in body).toBe(false);
    expect('status' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC4 — confirmation
// ---------------------------------------------------------------------------

describe('AC4 — confirmation', () => {
  test('it shows the request number, the email that will get updates, and a way home', async () => {
    mount();

    await fillAndSend();

    expect(await screen.findByText(/request number 1042/i)).toBeInTheDocument();
    expect(screen.getByText(/nadia@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my requests' })).toHaveAttribute(
      'href',
      '/portal',
    );

    // The form is gone, so the number cannot be lost by a stray second submit.
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
  });

  test('a failed submission says so and keeps the form', async () => {
    respondWith(422);

    mount();

    await fillAndSend();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// AC5 — friendly validation
// ---------------------------------------------------------------------------

describe('AC5 — friendly validation', () => {
  test('a missing subject is refused in plain words, and nothing is posted', async () => {
    mount();

    await fillAndSend({ subject: null });

    expect(await screen.findByText('Please tell us what you need help with.')).toBeInTheDocument();

    // Client-side, so the customer is not waiting on a round trip to be told.
    expect(submissions()).toEqual([]);
  });

  test('a missing description is refused in plain words', async () => {
    const user = userEvent.setup();

    mount();

    await user.type(screen.getByLabelText('What do you need help with?'), 'Refund');
    await user.click(screen.getByRole('combobox', { name: 'How urgent is it?' }));
    await user.click(await screen.findByRole('option', { name: 'I need help soon' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('Please tell us what is happening.')).toBeInTheDocument();
    expect(submissions()).toEqual([]);
  });

  test('a missing urgency is refused in plain words', async () => {
    const user = userEvent.setup();

    mount();

    await user.type(screen.getByLabelText('What do you need help with?'), 'Refund');
    await user.type(screen.getByLabelText('Tell us more'), 'Nothing arrived.');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('Please let us know how urgent it is.')).toBeInTheDocument();
    expect(submissions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('the form renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    publishSession(SESSION);

    const { container } = render(
      <MemoryRouter initialEntries={['/portal/new']}>
        <AppProviders>
          <Routes>
            <Route path="/portal/new" element={<PortalSubmitPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByText('اطلب مساعدتنا')).toBeInTheDocument();

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
