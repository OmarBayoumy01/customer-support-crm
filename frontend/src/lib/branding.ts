/**
 * Runtime accent branding — US-26, AC4.
 *
 * An administrator picks an accent colour and the app follows on the next load,
 * with no rebuild. That works because every accent-derived surface in
 * `styles/index.css` is expressed as a `var()` off `--accent-base`, so setting
 * one custom property on `:root` moves all of them.
 *
 * Deliberately narrow: **only the accent is brandable.** The greys are the
 * instrument the product is read through, and the urgency ramp means something
 * — letting an administrator recolour "breached" would be letting them turn the
 * alarm off.
 */

/** The palette default, so `resetBrandAccent` has something to go back to. */
const DEFAULT_ACCENT = '#3a36c4';

/** `#rgb` or `#rrggbb`. Anything else is refused rather than written blindly. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  if (!HEX.test(hex)) {
    return null;
  }

  const raw = hex.slice(1);
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Relative luminance, per WCAG 2.1. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);

  if (rgb === null) {
    return 0;
  }

  const channel = (value: number): number => {
    const v = value / 255;

    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Contrast ratio between two hex colours, per WCAG 2.1.
 *
 * Exported because AC5 is testable, and a contrast requirement that is only
 * checked by eye is a contrast requirement that regresses.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Hue angle in degrees, 0–360.
 *
 * Separate from `contrastRatio` because the two answer different questions, and
 * confusing them is easy: contrast is a *lightness* measure, so a saturated
 * indigo and a saturated red of similar lightness score barely above 1:1 while
 * being impossible to mistake for one another. "Could an agent confuse the
 * primary button with a breach?" is a question about hue.
 */
export function hueOf(hex: string): number {
  const rgb = parseHex(hex);

  if (rgb === null) {
    return 0;
  }

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue: number;

  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return (hue * 60 + 360) % 360;
}

/** The shorter way round the colour wheel between two hues, 0–180. */
export function hueDistance(a: string, b: string): number {
  const raw = Math.abs(hueOf(a) - hueOf(b));

  return Math.min(raw, 360 - raw);
}

/** Mixes towards black (`amount` < 0) or white (`amount` > 0). */
function shift(hex: string, amount: number): string {
  const rgb = parseHex(hex);

  if (rgb === null) {
    return hex;
  }

  const target = amount > 0 ? 255 : 0;
  const weight = Math.abs(amount);

  return toHex({
    r: rgb.r + (target - rgb.r) * weight,
    g: rgb.g + (target - rgb.g) * weight,
    b: rgb.b + (target - rgb.b) * weight,
  });
}

/**
 * Which of black or white to put on top of the accent.
 *
 * Chosen rather than assumed: an administrator who picks a pale yellow gets
 * dark text on their buttons instead of unreadable white ones. This is the
 * difference between "brandable" and "brandable without breaking AC5".
 */
export function readableTextOn(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#12161d', background)
    ? '#ffffff'
    : '#12161d';
}

export interface BrandAccent {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentContrast: string;
}

/** Derives the hover and soft variants an accent needs, plus its text colour. */
export function deriveAccent(hex: string): BrandAccent | null {
  if (parseHex(hex) === null) {
    return null;
  }

  return {
    accent: hex.toLowerCase(),
    accentStrong: shift(hex, -0.22),
    accentSoft: shift(hex, 0.88),
    accentContrast: readableTextOn(hex),
  };
}

/**
 * Applies an accent to the document.
 *
 * Returns whether it was applied, so a settings screen can report a rejected
 * value rather than silently doing nothing.
 */
export function applyBrandAccent(
  hex: string,
  root: HTMLElement = document.documentElement,
): boolean {
  const derived = deriveAccent(hex);

  if (derived === null) {
    return false;
  }

  root.style.setProperty('--accent-base', derived.accent);
  root.style.setProperty('--accent-strong', derived.accentStrong);
  root.style.setProperty('--accent-soft', derived.accentSoft);
  root.style.setProperty('--accent-contrast', derived.accentContrast);

  return true;
}

/** Returns the document to the palette default. */
export function resetBrandAccent(root: HTMLElement = document.documentElement): void {
  for (const property of [
    '--accent-base',
    '--accent-strong',
    '--accent-soft',
    '--accent-contrast',
  ]) {
    root.style.removeProperty(property);
  }
}

export { DEFAULT_ACCENT };
