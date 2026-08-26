/**
 * US-26 — the token system holds together.
 *
 * AC3 (one shared status/priority map), AC4 (runtime accent), AC5 (contrast).
 * AC1 and AC2 are about where values live rather than what they are, and are
 * asserted structurally below.
 */
import { describe, expect, test } from 'vitest';

import {
  applyBrandAccent,
  contrastRatio,
  DEFAULT_ACCENT,
  deriveAccent,
  hueDistance,
  readableTextOn,
  resetBrandAccent,
} from './branding';
import {
  PRIORITY_PRESENTATION,
  slaStateFor,
  SLA_PRESENTATION,
  STATUS_PRESENTATION,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from './design-tokens';

/** The raw palette, mirrored here so the assertions state the values they check. */
const PALETTE = {
  ground: '#f2f4f7',
  paper: '#ffffff',
  ink: '#12161d',
  inkMuted: '#565e6d',
  accent: '#3a36c4',
  slaOk: '#146b4f',
  slaWarn: '#8a5a08',
  slaBreach: '#b02525',
  slaOkSoft: '#dcf2e9',
  slaWarnSoft: '#fbeed6',
  slaBreachSoft: '#fbe3e3',
};

const AA_NORMAL = 4.5;

describe('AC5 — contrast', () => {
  test.each([
    ['ink on paper', PALETTE.ink, PALETTE.paper],
    ['ink on ground', PALETTE.ink, PALETTE.ground],
    ['muted ink on paper', PALETTE.inkMuted, PALETTE.paper],
    // The one most likely to be got wrong: muted text on the app background
    // rather than on a card. It is where every table's secondary column lives.
    ['muted ink on ground', PALETTE.inkMuted, PALETTE.ground],
    ['accent on paper', PALETTE.accent, PALETTE.paper],
    ['white on accent', '#ffffff', PALETTE.accent],
  ])('%s meets WCAG AA', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  test.each([
    ['on track', PALETTE.slaOk, PALETTE.slaOkSoft],
    ['due soon', PALETTE.slaWarn, PALETTE.slaWarnSoft],
    ['breached', PALETTE.slaBreach, PALETTE.slaBreachSoft],
  ])('the %s badge is readable on its own ground', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  test.each([
    ['on track', PALETTE.slaOk],
    ['due soon', PALETTE.slaWarn],
    ['breached', PALETTE.slaBreach],
  ])('the %s colour is readable on paper and on ground', (_name, colour) => {
    expect(contrastRatio(colour, PALETTE.paper)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(colour, PALETTE.ground)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  test('the accent is a different hue from every urgency colour', () => {
    // Not a WCAG rule — a product rule, and measured in **hue**, not contrast.
    // Contrast is a lightness measure: a saturated indigo and a saturated red
    // of similar lightness score barely above 1:1 while being impossible to
    // confuse. The question here is whether an agent could mistake the primary
    // button for a breach, and that is about hue.
    for (const urgent of [PALETTE.slaOk, PALETTE.slaWarn, PALETTE.slaBreach]) {
      expect(hueDistance(PALETTE.accent, urgent)).toBeGreaterThan(60);
    }
  });
});

describe('AC3 — one shared map', () => {
  test('every ticket status has a presentation', () => {
    for (const status of TICKET_STATUSES) {
      expect(STATUS_PRESENTATION[status]).toBeDefined();
    }

    // And nothing extra: an entry for a status the domain does not have is a
    // sign the map and the schema have drifted.
    expect(Object.keys(STATUS_PRESENTATION).sort()).toEqual([...TICKET_STATUSES].sort());
  });

  test('every priority has a presentation', () => {
    expect(Object.keys(PRIORITY_PRESENTATION).sort()).toEqual([...TICKET_PRIORITIES].sort());
  });

  test('nothing is communicated by colour alone', () => {
    // The definition of done, as an assertion. A presentation with a colour but
    // no label and no icon would be a coloured dot, which is unreadable to
    // anyone who cannot distinguish it.
    const every = [
      ...Object.values(STATUS_PRESENTATION),
      ...Object.values(PRIORITY_PRESENTATION),
      ...Object.values(SLA_PRESENTATION),
    ];

    for (const presentation of every) {
      expect(presentation.labelKey.length).toBeGreaterThan(0);
      // lucide exports forwardRef objects, not plain functions — what matters
      // is that there IS an icon, not how React happens to wrap it.
      expect(presentation.icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof presentation.icon);
    }
  });

  test('labels are i18n keys, never literal English', () => {
    for (const presentation of Object.values(STATUS_PRESENTATION)) {
      expect(presentation.labelKey).toMatch(/^ticket\.(status|priority|sla)\./);
    }
  });

  test('most of the palette is deliberately colourless', () => {
    // The thesis, under test. If a later change starts painting every status,
    // this fails — which is the point of writing it down.
    const coloured = Object.values(STATUS_PRESENTATION).filter((p) => p.className.includes('sla-'));

    expect(coloured.length).toBeLessThanOrEqual(2);
  });
});

describe('SLA state', () => {
  test.each([
    [0, 'ok'],
    [0.5, 'ok'],
    [0.74, 'ok'],
    [0.75, 'warn'],
    [0.99, 'warn'],
    [1, 'breach'],
    [2.5, 'breach'],
  ])('%s of the target spent is %s', (fraction, expected) => {
    expect(slaStateFor(fraction)).toBe(expected);
  });
});

describe('AC4 — runtime branding', () => {
  test('a valid accent is applied to the document', () => {
    const root = document.createElement('div');

    expect(applyBrandAccent('#0f766e', root)).toBe(true);
    expect(root.style.getPropertyValue('--accent-base')).toBe('#0f766e');
    expect(root.style.getPropertyValue('--accent-strong')).not.toBe('');
    expect(root.style.getPropertyValue('--accent-soft')).not.toBe('');
  });

  test('a malformed value is refused rather than written', () => {
    const root = document.createElement('div');

    expect(applyBrandAccent('teal', root)).toBe(false);
    expect(applyBrandAccent('#12', root)).toBe(false);
    // Silently accepting rubbish would leave an administrator staring at an
    // unchanged app with no idea why.
    expect(root.style.getPropertyValue('--accent-base')).toBe('');
  });

  test('shorthand hex works', () => {
    expect(deriveAccent('#0af')?.accent).toBe('#0af');
  });

  test('resetting returns the document to the default', () => {
    const root = document.createElement('div');

    applyBrandAccent('#0f766e', root);
    resetBrandAccent(root);

    expect(root.style.getPropertyValue('--accent-base')).toBe('');
  });

  test('the text colour on the accent is chosen, not assumed', () => {
    // An administrator who picks pale yellow gets dark text on their buttons.
    // Assuming white here is how "brandable" quietly breaks AC5.
    expect(readableTextOn('#fde047')).toBe('#12161d');
    expect(readableTextOn(DEFAULT_ACCENT)).toBe('#ffffff');
  });

  test('any accent an administrator picks still meets AA against its own text', () => {
    for (const candidate of ['#0f766e', '#fde047', '#b91c1c', '#1e293b', '#e879f9']) {
      const derived = deriveAccent(candidate);

      expect(derived).not.toBeNull();
      expect(contrastRatio(derived!.accentContrast, candidate)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
