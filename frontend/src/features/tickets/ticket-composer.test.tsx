/**
 * US-1 — the composer.
 *
 * AC1 Reply is the default · AC2 note mode is unmistakable · AC3 the draft
 * survives a mode change, and the change is warned about · AC6 the send action
 * reflects the mode.
 *
 * AC4 (how a note renders in the timeline) is covered by
 * `ticket-conversation.test.tsx`. AC5 and AC7 are the portal, which is US-82 —
 * the rule they depend on is asserted in `backend/src/tickets/tickets.test.ts`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { TicketComposer } from './ticket-composer';

const realAdapter = http.defaults.adapter;
const TICKET_ID = '01923456-89ab-7cde-8f01-234567890abc';

let sent: InternalAxiosRequestConfig[] = [];

const posted = (): { body: string; isInternal: boolean }[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'post')
    .map((request) => JSON.parse(String(request.data)) as { body: string; isInternal: boolean });

beforeEach(async () => {
  sent = [];
  await i18n.changeLanguage('en');

  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const payload = JSON.parse(String(config.data ?? '{}')) as { isInternal?: boolean };

    return Promise.resolve({
      data: { data: { id: 'm1', isInternal: payload.isInternal ?? false } },
      status: 201,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;

  render(
    <AppProviders>
      <TicketComposer ticketId={TICKET_ID} />
    </AppProviders>,
  );
});

afterEach(() => {
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 — Reply by default
// ---------------------------------------------------------------------------

describe('AC1 — Reply is the default', () => {
  test('the Reply tab is selected and the note warning is absent', () => {
    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // The safe-by-accident case is the one an agent expects.
    expect(screen.queryByText(/not visible to the customer/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 — note mode is unmistakable
// ---------------------------------------------------------------------------

describe('AC2 — Internal Note mode', () => {
  test('the whole composer changes, with a lock and the words above the box', async () => {
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));

    // The words, above the text area, at the moment the agent is typing.
    expect(screen.getByText('Internal note — not visible to the customer')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: 'Internal note' });
    const composer = textarea.closest('div.space-y-2');

    // The amber treatment is on the whole composer, not on a corner of it — a
    // single toggle you can miss is how the accident happens.
    expect(composer?.className).toContain('bg-sla-warn-soft');
  });
});

// ---------------------------------------------------------------------------
// AC3 — the draft survives, and the switch is warned about
// ---------------------------------------------------------------------------

describe('AC3 — switching modes with a draft', () => {
  test('an empty composer switches straight away, with no interruption', async () => {
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a draft is warned about, and kept when the switch is confirmed', async () => {
    const user = userEvent.setup();

    const textarea = screen.getByRole('textbox', { name: 'Reply' });
    await user.type(textarea, 'The refund cleared this morning.');

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Turn this reply into an internal note?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Internal note' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    // "Preserved *and* warned", not "warned *then* discarded".
    expect(screen.getByRole('textbox', { name: 'Internal note' })).toHaveValue(
      'The refund cleared this morning.',
    );
  });

  test('cancelling leaves the mode alone and the draft intact', async () => {
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Half a sentence');
    await user.click(screen.getByRole('tab', { name: 'Internal note' }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Half a sentence');
  });
});

// ---------------------------------------------------------------------------
// AC6 — the send action reflects the mode
// ---------------------------------------------------------------------------

describe('AC6 — the send action', () => {
  test('it reads Send in reply mode and Add note in note mode', async () => {
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));

    // The last thing an agent reads before committing says which of the two
    // they are doing.
    expect(screen.getByRole('button', { name: /Add note/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
  });

  test('nothing can be sent while the box is empty', () => {
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
  });

  test('a reply posts with isInternal false', async () => {
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'On its way.');
    await user.click(screen.getByRole('button', { name: /Send/ }));

    await waitFor(() => {
      expect(posted()).toHaveLength(1);
    });

    expect(posted()[0]).toEqual({ body: 'On its way.', isInternal: false });
  });

  test('a note posts with isInternal true, and the box empties', async () => {
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));
    await user.type(screen.getByRole('textbox', { name: 'Internal note' }), 'Chase payments.');
    await user.click(screen.getByRole('button', { name: /Add note/ }));

    await waitFor(() => {
      expect(posted()).toHaveLength(1);
    });

    expect(posted()[0]).toEqual({ body: 'Chase payments.', isInternal: true });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Internal note' })).toHaveValue('');
    });
  });
});

// ---------------------------------------------------------------------------
// Bilingual
// ---------------------------------------------------------------------------

describe('bilingual', () => {
  test('the composer renders in Arabic', async () => {
    await i18n.changeLanguage('ar');

    // The composer was mounted in English by `beforeEach`; `findBy` waits for
    // the re-render that the language change triggers.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'ملاحظة داخلية' }));

    expect(screen.getByText('ملاحظة داخلية — غير مرئية للعميل')).toBeInTheDocument();
  });
});
