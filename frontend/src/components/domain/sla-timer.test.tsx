/**
 * US-69 — the SLA timer.
 *
 * AC2 human phrasing · AC3 four states, each with a text label · AC4 the
 * expandable detail · AC5 the live countdown.
 *
 * AC1 (both timers above the fold) is US-45's header and is asserted in
 * `ticket-detail-page.test.tsx`. AC6 is asserted here as the shared presentation
 * tokens, since the queue's `SlaMeter` reads the same ones.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { SLA_MET_PRESENTATION, SLA_PRESENTATION } from '@/lib/design-tokens';
import { SlaTimer, slaDisplayState, type SlaTimerProps } from './sla-timer';

/** A fixed clock, so every assertion is against a known instant. */
const NOW = new Date('2026-08-27T12:00:00.000Z');
const STARTED = '2026-08-27T11:00:00.000Z';

/** Minutes from NOW, as an ISO string. */
const inMinutes = (minutes: number): string =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();

function props(overrides: Partial<SlaTimerProps> = {}): SlaTimerProps {
  return {
    kind: 'response',
    dueAt: inMinutes(18),
    breached: false,
    met: false,
    startedAt: STARTED,
    policyName: 'VIP',
    targetMinutes: 30,
    pausedAt: null,
    pausedMs: 0,
    ...overrides,
  };
}

function mount(overrides: Partial<SlaTimerProps> = {}): void {
  render(
    <AppProviders>
      <SlaTimer {...props(overrides)} />
    </AppProviders>,
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// AC2 — human phrasing
// ---------------------------------------------------------------------------

describe('AC2 — it reads as a sentence', () => {
  test('a running clock says what is due and when', () => {
    mount();

    expect(screen.getByText('First response due in 18m')).toBeInTheDocument();
  });

  test('a passed clock says how late it is, not how much is left', () => {
    mount({ dueAt: inMinutes(-40) });

    expect(screen.getByText('First response overdue by 40m')).toBeInTheDocument();
  });

  test('a ticket with no policy says so rather than showing a number', () => {
    mount({ dueAt: null, targetMinutes: null, policyName: null });

    expect(screen.getByText('First response: no target')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3 — the four states, each named
// ---------------------------------------------------------------------------

describe('AC3 — state, always with a label', () => {
  test('on track, at risk and breached each name themselves', () => {
    // A 30-minute target that started an hour ago: comfortably inside it at
    // 18 minutes to go, at risk with 5, and past it at -1.
    for (const [dueAt, key] of [
      [inMinutes(50), SLA_PRESENTATION.ok.labelKey],
      [inMinutes(5), SLA_PRESENTATION.warn.labelKey],
      [inMinutes(-1), SLA_PRESENTATION.breach.labelKey],
    ] as const) {
      const { unmount } = render(
        <AppProviders>
          <SlaTimer {...props({ dueAt })} />
        </AppProviders>,
      );

      // The words, not the colour. The definition of done bans colour alone and
      // a screen reader gets nothing from a class name.
      expect(screen.getByText(i18n.t(key))).toBeInTheDocument();

      unmount();
    }
  });

  test('a met clock is grey, named, and shows no countdown', () => {
    mount({ met: true, dueAt: inMinutes(-40) });

    expect(screen.getByText(i18n.t(SLA_MET_PRESENTATION.labelKey))).toBeInTheDocument();
    expect(screen.getByText('First response met')).toBeInTheDocument();

    // The case a running countdown gets wrong: answered in time, deadline since
    // passed. It must not read as breached.
    expect(screen.queryByText(/overdue by/)).not.toBeInTheDocument();
  });

  test('met wins over a deadline in the past — the pure function says so', () => {
    expect(
      slaDisplayState({
        dueAt: inMinutes(-40),
        breached: true,
        met: true,
        startedAt: STARTED,
        now: NOW,
      }),
    ).toBe('met');

    expect(
      slaDisplayState({
        dueAt: inMinutes(-40),
        breached: true,
        met: false,
        startedAt: STARTED,
        now: NOW,
      }),
    ).toBe('breach');
  });
});

// ---------------------------------------------------------------------------
// AC4 — expandable detail
// ---------------------------------------------------------------------------

describe('AC4 — the detail behind the number', () => {
  test('expanding shows the target, the deadline and the policy', async () => {
    const user = userEvent.setup();

    mount();

    await user.click(screen.getByRole('button'));

    expect(await screen.findByText('Target')).toBeInTheDocument();
    // 30 minutes, through the one duration formatter the queue also uses.
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('Policy')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
  });

  test('a stopped clock says it is paused, and since when', async () => {
    const user = userEvent.setup();

    mount({ kind: 'resolution', pausedAt: '2026-08-27T11:30:00.000Z' });

    await user.click(screen.getByRole('button'));

    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
  });

  test('a clock that was paused earlier shows the total', async () => {
    const user = userEvent.setup();

    // Fifteen minutes banked, running again now.
    mount({ kind: 'resolution', pausedAt: null, pausedMs: 15 * 60_000 });

    await user.click(screen.getByRole('button'));

    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC5 — live countdown
// ---------------------------------------------------------------------------

describe('AC5 — it ticks', () => {
  test('the number falls without a refetch', () => {
    mount();

    expect(screen.getByText('First response due in 18m')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Nothing refetched; the same props with a later now.
    expect(screen.getByText('First response due in 17m')).toBeInTheDocument();
  });

  test('it changes state as it crosses a threshold', () => {
    // The fraction is measured from when the clock started to its deadline, not
    // from the policy's target: a 14-minute window with 10 minutes gone is 71%,
    // and one more minute crosses 75%.
    mount({ startedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), dueAt: inMinutes(4) });

    expect(screen.getByText(i18n.t(SLA_PRESENTATION.ok.labelKey))).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // The colour changes because the state does, and the state is recomputed on
    // every tick rather than fixed when the payload arrived.
    expect(screen.getByText(i18n.t(SLA_PRESENTATION.warn.labelKey))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('it renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = render(
      <AppProviders>
        <SlaTimer {...props()} />
      </AppProviders>,
    );

    expect(screen.getByText(/أول رد/)).toBeInTheDocument();

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
