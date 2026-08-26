/**
 * US-46 — the conversation timeline.
 *
 * AC1 four entry types, each visually distinct · AC2 internal notes
 * unmistakable · AC3 channel provenance · AC4 attachments inline ·
 * AC5 long threads load earlier on demand · AC6 system events are quiet.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { TicketMessage } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { TicketConversation } from './ticket-conversation';

const HOUR = 3_600_000;
let sequence = 0;

function message(overrides: Partial<TicketMessage> = {}): TicketMessage {
  sequence += 1;

  return {
    id: `m${String(sequence)}`,
    senderType: 'CUSTOMER',
    authorName: 'James Whitfield',
    body: 'The refund still has not arrived.',
    isInternal: false,
    channel: 'EMAIL',
    attachments: [],
    createdAt: new Date(Date.now() - HOUR).toISOString(),
    ...overrides,
  };
}

function renderThread(props: Partial<React.ComponentProps<typeof TicketConversation>> = {}): void {
  render(
    <AppProviders>
      <TicketConversation
        messages={props.messages ?? [message()]}
        description={props.description ?? null}
        createdAt={props.createdAt ?? new Date(Date.now() - 6 * HOUR).toISOString()}
        customerName={props.customerName ?? 'James Whitfield'}
        {...(props.messageCount === undefined ? {} : { messageCount: props.messageCount })}
        {...(props.onLoadEarlier === undefined ? {} : { onLoadEarlier: props.onLoadEarlier })}
        {...(props.isLoadingEarlier === undefined
          ? {}
          : { isLoadingEarlier: props.isLoadingEarlier })}
      />
    </AppProviders>,
  );
}

beforeEach(async () => {
  sequence = 0;
  await i18n.changeLanguage('en');
});

// ---------------------------------------------------------------------------
// AC1 and AC6 — the four entry types
// ---------------------------------------------------------------------------

describe('AC1 — four entry types', () => {
  test('customer, agent, internal note and system event each render differently', () => {
    renderThread({
      messages: [
        message({ body: 'From the customer.' }),
        message({ senderType: 'AGENT', authorName: 'Huda Mansour', body: 'From the agent.' }),
        message({
          senderType: 'AGENT',
          authorName: 'Huda Mansour',
          isInternal: true,
          channel: null,
          body: 'A note to the team.',
        }),
        message({
          senderType: 'SYSTEM',
          authorName: null,
          channel: null,
          body: 'Status changed to Escalated',
        }),
      ],
    });

    const entries = screen.getAllByRole('listitem');

    // Four entries plus the scroll anchor at the foot.
    expect(entries.length).toBeGreaterThanOrEqual(4);

    expect(screen.getByText('From the customer.')).toBeInTheDocument();
    expect(screen.getByText('From the agent.')).toBeInTheDocument();
    expect(screen.getByText('A note to the team.')).toBeInTheDocument();
    expect(screen.getByText(/Status changed to Escalated/)).toBeInTheDocument();
  });

  test('a customer message and an agent reply sit on opposite sides', () => {
    renderThread({
      messages: [
        message({ body: 'From the customer.' }),
        message({ senderType: 'AGENT', authorName: 'Huda Mansour', body: 'From the agent.' }),
      ],
    });

    // Alignment is the encoding AC1 asks for, and it is a logical property so
    // that Arabic mirrors it without a second rule.
    const customerEntry = screen.getByText('From the customer.').closest('li');
    const agentEntry = screen.getByText('From the agent.').closest('li');

    expect(customerEntry?.className).toContain('items-start');
    expect(agentEntry?.className).toContain('items-end');
  });
});

describe('AC6 — system events are quiet', () => {
  test('a system event is a centred line, not a bubble', () => {
    renderThread({
      messages: [
        message({
          senderType: 'SYSTEM',
          authorName: null,
          channel: null,
          body: 'Assigned to Huda Mansour',
        }),
      ],
    });

    const entry = screen.getByText(/Assigned to Huda Mansour/).closest('li');

    expect(entry?.className).toContain('justify-center');
    // No author line, no channel tag — context, not correspondence.
    expect(screen.queryByText('Email')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 — internal notes
// ---------------------------------------------------------------------------

describe('AC2 — internal notes are unmistakable', () => {
  test('full width, amber, a lock, and the words in full', () => {
    renderThread({
      messages: [
        message({
          senderType: 'AGENT',
          authorName: 'Huda Mansour',
          isInternal: true,
          channel: null,
          body: 'Do not promise a date until the batch clears.',
        }),
      ],
    });

    // The words, in full. The project's first non-negotiable rule lives on this
    // distinction, so it is spelled out rather than abbreviated to a badge.
    expect(screen.getByText('Not visible to the customer')).toBeInTheDocument();

    const note = screen.getByText('Do not promise a date until the batch clears.').closest('div');

    expect(note?.className).toContain('bg-sla-warn-soft');
    expect(note?.className).toContain('border-dashed');

    // Full width: unlike either bubble, which cap at 85%.
    expect(note?.className).not.toContain('max-w-[85%]');
  });

  test('an agent reply carries no such label', () => {
    renderThread({
      messages: [message({ senderType: 'AGENT', authorName: 'Huda Mansour', body: 'On its way.' })],
    });

    expect(screen.queryByText('Not visible to the customer')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC3 — channel provenance
// ---------------------------------------------------------------------------

describe('AC3 — channel provenance', () => {
  test('each message names the channel it travelled on', () => {
    renderThread({
      messages: [
        message({ channel: 'EMAIL', body: 'Opened by email.' }),
        message({ channel: 'WHATSAPP', body: 'Continued on WhatsApp.' }),
      ],
    });

    // Named, not just iconed — a glyph alone communicates nothing.
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  test('a message with no channel says nothing rather than guessing', () => {
    renderThread({ messages: [message({ channel: null, body: 'No channel.' })] });

    for (const channel of ['Email', 'WhatsApp', 'Chat', 'SMS', 'Web']) {
      expect(screen.queryByText(channel)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — attachments
// ---------------------------------------------------------------------------

describe('AC4 — attachments inline', () => {
  test('files render on their message as chips with a name and a size', () => {
    renderThread({
      messages: [
        message({
          body: 'Here is the statement.',
          attachments: [
            {
              id: 'a1',
              messageId: 'm1',
              fileName: 'statement.pdf',
              contentType: 'application/pdf',
              sizeBytes: 284_113,
            },
            {
              id: 'a2',
              messageId: 'm1',
              fileName: 'screenshot.png',
              contentType: 'image/png',
              sizeBytes: 900,
            },
          ],
        }),
      ],
    });

    const entry = screen.getByText('Here is the statement.').closest('li');

    expect(within(entry!).getByText('statement.pdf')).toBeInTheDocument();
    expect(within(entry!).getByText('277 KB')).toBeInTheDocument();
    expect(within(entry!).getByText('screenshot.png')).toBeInTheDocument();
    expect(within(entry!).getByText('900 B')).toBeInTheDocument();
  });

  test('a chip is not a link, because there is nothing behind the key yet', () => {
    renderThread({
      messages: [
        message({
          body: 'Attached.',
          attachments: [
            {
              id: 'a1',
              messageId: 'm1',
              fileName: 'statement.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1024,
            },
          ],
        }),
      ],
    });

    // Object storage arrives with US-51. A link that 404s teaches people the
    // feature is broken; this says where the work stopped.
    expect(screen.queryByRole('link', { name: /statement\.pdf/ })).toBeNull();
    expect(screen.getByText('statement.pdf')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — long threads
// ---------------------------------------------------------------------------

describe('AC5 — long threads', () => {
  test('a thread with more messages than were sent offers to load the rest', async () => {
    const user = userEvent.setup();
    const onLoadEarlier = vi.fn();

    renderThread({
      messages: [message(), message()],
      messageCount: 42,
      onLoadEarlier,
    });

    const button = screen.getByRole('button', { name: 'Show 40 earlier messages' });

    await user.click(button);

    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  test('a thread that arrived whole offers nothing', () => {
    renderThread({ messages: [message(), message()], messageCount: 2 });

    expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
  });

  test('the view scrolls to the latest message on arrival', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderThread({ messages: [message(), message()] });

    // A conversation is read from the bottom: what was said last is what you
    // are replying to.
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bilingual
// ---------------------------------------------------------------------------

describe('bilingual', () => {
  test('the timeline renders in Arabic', async () => {
    await i18n.changeLanguage('ar');

    renderThread({
      messages: [
        message({ channel: 'WHATSAPP' }),
        message({ isInternal: true, channel: null, body: 'ملاحظة للفريق.' }),
      ],
    });

    expect(screen.getByText('غير مرئية للعميل')).toBeInTheDocument();
    expect(screen.getByText('واتساب')).toBeInTheDocument();
  });
});
