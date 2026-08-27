/**
 * US-84 — the customer's request list.
 *
 * AC1 cards rather than a data table · AC2 only search, status and date ·
 * AC3 the reply-needed marker · AC5 the empty state.
 *
 * The scoping, the filters reaching the database and the status translation are
 * asserted in `backend/src/portal/portal-list.test.ts`.
 *
 * **AC4 (inline star rating) is unmet and untested.** Rating is US-88, deferred:
 * no column, no endpoint, nowhere to put a star. There are no stars here, and
 * there is a test below asserting that — five stars that discarded the click
 * would invite feedback and throw it away.
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
import type { PortalTicket } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { resetSessionStore } from '@/lib/session-store';
import { PortalRequests } from './portal-requests';

const realAdapter = http.defaults.adapter;

const WAITING: PortalTicket = {
  id: '01923456-89ab-7cde-8f01-2345678900a1',
  number: 1042,
  subject: 'My refund has not arrived',
  status: 'WAITING_ON_YOU',
  categoryName: 'Billing',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-20T14:30:00.000Z',
};

const RESOLVED: PortalTicket = {
  id: '01923456-89ab-7cde-8f01-2345678900a2',
  number: 1043,
  subject: 'Delivery arrived damaged',
  status: 'RESOLVED',
  categoryName: null,
  createdAt: '2026-07-15T09:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
};

let sent: InternalAxiosRequestConfig[] = [];

/** The query strings the list actually asked for. */
const requested = (): string[] => sent.map((request) => request.url ?? '');

function respondWith(tickets: PortalTicket[], options: { fail?: boolean } = {}): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if (options.fail === true) {
      const response = {
        data: {
          error: {
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'boom',
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
        new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response),
      );
    }

    return Promise.resolve({
      data: {
        data: tickets,
        pagination: { page: 1, pageSize: 10, total: tickets.length, totalPages: 1 },
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
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <AppProviders>
        <Routes>
          <Route path="/portal" element={<PortalRequests />} />
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
  respondWith([WAITING, RESOLVED]);
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
// AC1 — cards
// ---------------------------------------------------------------------------

describe('AC1 — card layout', () => {
  test('each request shows its number, subject, category, opened date and last update', async () => {
    mount();

    expect(await screen.findByText('Request #1042')).toBeInTheDocument();
    expect(screen.getByText('My refund has not arrived')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    // The sentence, not one locale's date format: Intl decides the latter and an
    // assertion should not pin it. Both cards carry one, hence getAllByText.
    expect(screen.getAllByText(/^Opened .*2026/)).toHaveLength(2);
    expect(screen.getAllByText(/^Updated .*2026/)).toHaveLength(2);

    // A request with no category says so rather than leaving a gap.
    expect(screen.getByText('No category')).toBeInTheDocument();
  });

  test('it is not a data table', async () => {
    mount();

    await screen.findByText('Request #1042');

    // AC1 rules a dense table out explicitly. A list of cards is what a customer
    // with a handful of requests reads.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test('the status is a word, not only a colour', async () => {
    mount();

    expect(await screen.findByText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC2 — simple filters
// ---------------------------------------------------------------------------

describe('AC2 — simple filters', () => {
  test('it offers search, status and date', async () => {
    mount();

    await screen.findByText('Request #1042');

    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opened since')).toBeInTheDocument();
  });

  test('and offers nothing else — no assignee, department, branch or channel', async () => {
    mount();

    await screen.findByText('Request #1042');

    for (const forbidden of [/assignee/i, /department/i, /branch/i, /channel/i, /agent/i]) {
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  test('searching asks the server, rather than filtering in the browser', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Request #1042');
    await user.type(screen.getByLabelText('Search'), 'refund');

    await waitFor(() => {
      expect(requested().some((url) => url.includes('q=refund'))).toBe(true);
    });
  });

  test('the status filter sends the customer-facing value', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Request #1042');

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Waiting on you' }));

    await waitFor(() => {
      expect(requested().some((url) => url.includes('status=WAITING_ON_YOU'))).toBe(true);
    });

    // The internal name is never sent, and never rendered.
    expect(requested().every((url) => !url.includes('PENDING_CUSTOMER'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — action needed
// ---------------------------------------------------------------------------

describe('AC3 — action needed', () => {
  test('a request awaiting my reply is marked, in words as well as by colour', async () => {
    mount();

    // The words matter: an edge stripe on its own is colour-only signalling,
    // which the definition of done forbids.
    expect(await screen.findByText('Your reply needed')).toBeInTheDocument();
  });

  test('a request that is not waiting on me is not marked', async () => {
    respondWith([RESOLVED]);

    mount();

    await screen.findByText('Request #1043');

    expect(screen.queryByText('Your reply needed')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC4 — unmet
// ---------------------------------------------------------------------------

describe('AC4 — rating', () => {
  test('a resolved request offers no star rating, because there is nowhere to send one', async () => {
    respondWith([RESOLVED]);

    mount();

    await screen.findByText('Request #1043');

    // Rating is US-88, deferred: no column, no endpoint. Stars that discarded
    // the click would invite feedback and silently throw it away, which is worse
    // than not asking. **This test documents an unmet AC rather than covering
    // one** — when US-88 lands, it should be replaced.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/rat(e|ing)/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — empty, and the other empty
// ---------------------------------------------------------------------------

describe('AC5 — empty state', () => {
  test('no requests at all shows a friendly message and a submit button', async () => {
    respondWith([]);

    mount();

    expect(await screen.findByText('You have not asked us anything yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New request/ })).toHaveAttribute(
      'href',
      '/portal/new',
    );
  });

  test('no *matching* requests is a different message, offering to clear the filters', async () => {
    const user = userEvent.setup();

    mount();

    await screen.findByText('Request #1042');

    respondWith([]);
    await user.type(screen.getByLabelText('Search'), 'nothingmatches');

    // Telling somebody with twelve requests that they have never contacted
    // support is the failure this distinction avoids.
    expect(await screen.findByText('Nothing matches those filters.')).toBeInTheDocument();
    expect(screen.queryByText('You have not asked us anything yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// States and Arabic
// ---------------------------------------------------------------------------

describe('states', () => {
  // A 4xx, deliberately: createQueryClient retries a 5xx twice with backoff,
  // which is the right policy and would make this test a race against it.
  test('a failed load says so and offers to retry', async () => {
    respondWith([], { fail: true });

    mount();

    expect(
      await screen.findByText('We could not load your requests just now.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = mount();

    // The badge and the status label are deliberately different words, in both
    // languages — the same phrase twice on one card reads as a mistake.
    expect(await screen.findByText('يلزم ردّك')).toBeInTheDocument();
    expect(screen.getByText('بانتظار ردّك')).toBeInTheDocument();

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
