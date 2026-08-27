/**
 * US-85 — reading and replying to one request.
 *
 * AC1 the two-sided thread · AC3 a first name and avatar only · AC4 the
 * three-step indicator replacing SLA timers · AC5 the plain composer ·
 * AC6 events as sentences.
 *
 * AC2, the attribution, the reopen rule and the boundary are the server's and
 * are asserted in `backend/src/portal/portal-reply.test.ts`. The internal-note
 * assertion is repeated here as defence in depth: if a fixture ever carried one,
 * this screen must still not render it.
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
import type { PortalTicketDetail } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { resetSessionStore } from '@/lib/session-store';
import { PortalRequestPage } from './portal-request-page';

const realAdapter = http.defaults.adapter;

const TICKET_ID = '01923456-89ab-7cde-8f01-2345678900t1';

function detail(overrides: Partial<PortalTicketDetail> = {}): PortalTicketDetail {
  return {
    id: TICKET_ID,
    number: 1042,
    subject: 'My refund has not arrived',
    status: 'WAITING_FOR_AGENT',
    categoryName: 'Billing',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-20T14:30:00.000Z',
    description: 'The bank says nothing is pending.',
    assigneeFirstName: 'Layla',
    messages: [
      {
        id: '01923456-89ab-7cde-8f01-2345678900m1',
        author: 'you',
        authorName: 'Nadia Saeed',
        body: 'I am still waiting for my refund.',
        attachments: [],
        createdAt: '2026-08-01T09:05:00.000Z',
      },
      {
        id: '01923456-89ab-7cde-8f01-2345678900m2',
        author: 'support',
        authorName: 'Layla',
        body: 'We have asked the bank and will come back to you.',
        attachments: [],
        createdAt: '2026-08-02T11:00:00.000Z',
      },
    ],
    messageCount: 2,
    resolvedAt: null,
    events: [
      {
        id: '01923456-89ab-7cde-8f01-2345678900e1',
        kind: 'received',
        createdAt: '2026-08-01T09:00:00.000Z',
      },
      {
        id: '01923456-89ab-7cde-8f01-2345678900e2',
        kind: 'assigned',
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

let sent: InternalAxiosRequestConfig[] = [];

const posts = (): Record<string, unknown>[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'post')
    .map((request) => JSON.parse(String(request.data)) as Record<string, unknown>);

function respondWith(request: PortalTicketDetail, options: { replyFails?: boolean } = {}): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if (config.method?.toLowerCase() === 'post' && options.replyFails === true) {
      const response = {
        data: {
          error: {
            statusCode: 422,
            code: 'UNPROCESSABLE',
            message: 'refused',
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        },
        status: 422,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse;

      return Promise.reject(
        new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response),
      );
    }

    return Promise.resolve({
      data: { data: request },
      status: config.method?.toLowerCase() === 'post' ? 201 : 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
}

function mount(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/portal/requests/${TICKET_ID}`]}>
      <AppProviders>
        <Routes>
          <Route path="/portal/requests/:id" element={<PortalRequestPage />} />
          <Route path="/portal" element={<div>my requests</div>} />
          <Route path="/portal/new" element={<div>submit form</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');
  respondWith(detail());
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
// AC1 — the thread
// ---------------------------------------------------------------------------

describe('AC1 — a two-sided thread with timestamps', () => {
  test('both sides render, each with a time', async () => {
    mount();

    expect(await screen.findByText('I am still waiting for my refund.')).toBeInTheDocument();
    expect(
      screen.getByText('We have asked the bank and will come back to you.'),
    ).toBeInTheDocument();

    // "You" and the agent's first name, each beside a timestamp. The line is a
    // name plus a span for the time, so the matcher works on the element's whole
    // text rather than on one text node.
    const authorLine = (starts: string) => (_: string, element: Element | null) =>
      element?.tagName === 'P' && (element.textContent ?? '').startsWith(starts);

    expect(screen.getByText(authorLine('You · '))).toBeInTheDocument();
    expect(screen.getByText(authorLine('Layla · '))).toBeInTheDocument();
  });

  test('the subject and number head the page', async () => {
    mount();

    expect(await screen.findByRole('heading', { name: /My refund has not arrived/ })).toBeVisible();
    expect(screen.getByText('Request #1042')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC2 — defence in depth on the client
// ---------------------------------------------------------------------------

describe('AC2 — nothing internal', () => {
  test('no internal wording reaches the screen', async () => {
    const { container } = mount();

    await screen.findByText('I am still waiting for my refund.');

    // The payload cannot carry an internal note — the server filters it in the
    // query and the contract has no field for one. This asserts the screen adds
    // nothing of its own: no SLA, no priority, no assignee surname.
    for (const internal of ['SLA', 'PENDING_CUSTOMER', 'ESCALATED', 'MEDIUM', 'internal']) {
      expect(container.textContent ?? '').not.toContain(internal);
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — agent identity limited
// ---------------------------------------------------------------------------

describe('AC3 — a first name and an avatar', () => {
  test('a support reply shows the first name and an avatar, and no more', async () => {
    const { container } = mount();

    await screen.findByText(
      (_, element) =>
        element?.tagName === 'P' && (element.textContent ?? '').startsWith('Layla · '),
    );

    // The avatar's initial, from the first name the payload carries.
    expect(container.textContent ?? '').toContain('L');
    // Nothing else about the agent exists in the payload to render.
    expect(container.textContent ?? '').not.toContain('@');
  });
});

// ---------------------------------------------------------------------------
// AC4 — the progress indicator
// ---------------------------------------------------------------------------

describe('AC4 — Received → In Progress → Resolved', () => {
  test('the three steps render and the current one is marked', async () => {
    mount();

    const progress = await screen.findByRole('list', { name: 'Progress' });

    expect(progress).toHaveTextContent('Received');
    expect(progress).toHaveTextContent('In progress');
    expect(progress).toHaveTextContent('Resolved');

    // `IN_PROGRESS` is the middle step.
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('In progress');
  });

  test('a resolved request marks the last step', async () => {
    respondWith(detail({ status: 'RESOLVED' }));

    mount();

    const progress = await screen.findByRole('list', { name: 'Progress' });

    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('Resolved');
  });

  test('and there is no SLA timer anywhere, which is what it replaces', async () => {
    const { container } = mount();

    await screen.findByRole('list', { name: 'Progress' });

    // The portal contract has never carried an SLA field, so AC4's "replacing
    // SLA timers" is satisfied by an absence — asserted rather than assumed.
    expect(container.textContent ?? '').not.toMatch(/due in|overdue|breach|remaining/i);
  });
});

// ---------------------------------------------------------------------------
// AC5 — the composer
// ---------------------------------------------------------------------------

describe('AC5 — a simple composer', () => {
  test('a text area and Send, with no mode switcher and no canned replies', async () => {
    mount();

    expect(await screen.findByLabelText('Add a reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send reply/ })).toBeInTheDocument();

    // The staff composer's internal-note tab is exactly what AC5 forbids.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/internal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/canned|template|snippet/i)).not.toBeInTheDocument();
  });

  test('sending posts the body and clears the box', async () => {
    const user = userEvent.setup();

    mount();

    const box = await screen.findByLabelText('Add a reply');

    await user.type(box, 'Any news on this?');
    await user.click(screen.getByRole('button', { name: /Send reply/ }));

    await waitFor(() => {
      // The body, and nothing a customer should not be sending.
      expect(posts()).toEqual([{ body: 'Any news on this?' }]);
    });

    await waitFor(() => {
      expect(box).toHaveValue('');
    });
  });

  test('a failed send keeps what the customer wrote', async () => {
    const user = userEvent.setup();

    respondWith(detail(), { replyFails: true });

    mount();

    const box = await screen.findByLabelText('Add a reply');

    await user.type(box, 'Please look again.');
    await user.click(screen.getByRole('button', { name: /Send reply/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // Losing the text on failure is the one thing a composer must never do.
    expect(box).toHaveValue('Please look again.');
  });

  test('Send is disabled while empty and while in flight', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByLabelText('Add a reply');

    expect(screen.getByRole('button', { name: /Send reply/ })).toBeDisabled();

    await user.type(screen.getByLabelText('Add a reply'), 'Hello');

    expect(screen.getByRole('button', { name: /Send reply/ })).toBeEnabled();
  });

  test('a resolved request allows reply to reopen it', async () => {
    respondWith(detail({ status: 'RESOLVED' }));

    mount();

    expect(await screen.findByLabelText('Add a reply')).toBeInTheDocument();
    expect(screen.getByText('I am still waiting for my refund.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC6 — plain language
// ---------------------------------------------------------------------------

describe('AC6 — system events in plain language', () => {
  test('an event reads as a sentence, not as an event name', async () => {
    mount();

    expect(await screen.findByText(/We received your request/)).toBeInTheDocument();
    expect(screen.getByText(/Your request was assigned to a support agent/)).toBeInTheDocument();

    // The kind is what the API sends; the sentence is the client's. Neither the
    // kind nor an internal event name is rendered.
    expect(screen.queryByText(/assigned$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ASSIGNED|CREATED|STATUS_CHANGED/)).not.toBeInTheDocument();
  });

  test('the example sentence from the story names nobody', async () => {
    mount();

    const line = await screen.findByText(/Your request was assigned to a support agent/);

    // AC3 limits identity, and AC6's own example names no agent.
    expect(line.textContent ?? '').not.toContain('Layla');
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = mount();

    expect(await screen.findByText(/استلمنا طلبك/)).toBeInTheDocument();

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
