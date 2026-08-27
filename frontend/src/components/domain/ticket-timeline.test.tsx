/**
 * US-50, AC5 — the history panel.
 *
 * A compact vertical timeline, collapsed by default on long tickets. AC2 and
 * AC3 are asserted here too, on the rendering side: the backend proves the data
 * is right in `backend/src/tickets/ticket-history.test.ts`, this proves a
 * manager can actually read it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { TicketTimeline, type TicketHistoryEntry } from './ticket-timeline';

function entry(overrides: Partial<TicketHistoryEntry> = {}): TicketHistoryEntry {
  return {
    id: crypto.randomUUID(),
    eventType: 'PRIORITY_CHANGED',
    field: 'priority',
    fromValue: 'MEDIUM',
    toValue: 'HIGH',
    // Null for an enum field: a priority is already legible. US-48's labels
    // exist for the fields whose value is an id.
    fromLabel: null,
    toLabel: null,
    actorName: 'Aisha Haddad',
    automationRule: null,
    createdAt: '2026-08-20T09:15:00.000Z',
    ...overrides,
  };
}

/** Enough entries to cross the collapse threshold. */
function longHistory(count: number): TicketHistoryEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({ id: `entry-${String(index)}`, toValue: index % 2 === 0 ? 'HIGH' : 'LOW' }),
  );
}

function wrap(node: React.ReactNode): React.JSX.Element {
  return <AppProviders>{node}</AppProviders>;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('AC5 — presentation', () => {
  test('a short ticket shows everything, with no toggle', () => {
    render(wrap(<TicketTimeline entries={longHistory(3)} />));

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a long ticket is collapsed by default and expands on request', async () => {
    const user = userEvent.setup();

    render(wrap(<TicketTimeline entries={longHistory(10)} />));

    expect(screen.getAllByRole('listitem')).toHaveLength(4);

    await user.click(screen.getByRole('button', { name: 'Show 6 earlier events' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Show recent only' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  test('an empty history says so rather than rendering an empty rail', () => {
    render(wrap(<TicketTimeline entries={[]} />));

    expect(screen.getByText('Nothing has changed on this ticket yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('AC2 — attribution', () => {
  test('an entry names the field, both values, the actor and the exact time', () => {
    render(wrap(<TicketTimeline entries={[entry()]} />));

    expect(screen.getByText('Priority changed from Medium to High')).toBeInTheDocument();
    expect(screen.getByText('Aisha Haddad')).toBeInTheDocument();

    // The exact timestamp, machine-readable as well as rendered — a dispute
    // needs the time, not "3 hours ago".
    const time = screen.getByText(/2026/);
    expect(time).toHaveAttribute('datetime', '2026-08-20T09:15:00.000Z');
  });

  test('creation reads as an event, not as a field change', () => {
    render(
      wrap(
        <TicketTimeline
          entries={[entry({ eventType: 'CREATED', field: null, fromValue: null, toValue: null })]}
        />,
      ),
    );

    expect(screen.getByText('Ticket created')).toBeInTheDocument();
  });

  test('a first value with nothing before it reads as "set to"', () => {
    render(
      wrap(
        <TicketTimeline
          entries={[
            entry({
              eventType: 'CATEGORY_CHANGED',
              field: 'categoryId',
              fromValue: null,
              toValue: 'Billing',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Category set to Billing')).toBeInTheDocument();
  });
});

describe('AC3 — system versus human', () => {
  test('an automated entry names the rule and no person', () => {
    render(
      wrap(
        <TicketTimeline
          entries={[
            entry({
              eventType: 'ESCALATED',
              field: 'status',
              fromValue: 'OPEN',
              toValue: 'ESCALATED',
              actorName: null,
              automationRule: 'sla.first-response-breached',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Automation · sla.first-response-breached')).toBeInTheDocument();
    expect(screen.queryByText('Aisha Haddad')).toBeNull();
    expect(screen.getByText('Status changed from Open to Escalated')).toBeInTheDocument();
  });
});

describe('bilingual', () => {
  test('it renders in Arabic, translating the values as well as the sentence', async () => {
    await i18n.changeLanguage('ar');

    render(wrap(<TicketTimeline entries={[entry()]} />));

    expect(screen.getByText('تغيّر الأولوية من متوسطة إلى عالية')).toBeInTheDocument();
  });
});
