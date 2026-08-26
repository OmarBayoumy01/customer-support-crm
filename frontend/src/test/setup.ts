/**
 * Test setup, loaded before every frontend suite.
 *
 * Adds Testing Library's DOM matchers and clears the two browser stores between
 * tests — `auth-context.test.tsx` asserts the access token is *never* written to
 * either, and a leftover value from an earlier test would make that assertion
 * meaningless in whichever direction it happened to fall.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { resetSessionStore } from '../lib/session-store';
import { dismissToasts } from '../lib/toast';

/**
 * jsdom implements neither of these, and Radix's popover and dialog positioning
 * both reach for them. Without the stubs every combobox and dialog test fails
 * with "ResizeObserver is not defined", which looks like a component bug and is
 * an environment gap.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

/**
 * The rest of what Radix and cmdk expect from a DOM and jsdom does not provide.
 *
 * Reached through an index signature rather than the typed prototype, for two
 * reasons that pull the same way: reading `Element.prototype.scrollIntoView`
 * directly is an unbound method reference, which the lint rules object to, and
 * an `in` guard narrows the prototype to `never` because TypeScript knows the
 * property exists on the *type* even when jsdom has not implemented it.
 */
const elementProto = Element.prototype as unknown as Record<string, unknown>;

const stub = (name: string, implementation: () => unknown): void => {
  if (typeof elementProto[name] !== 'function') {
    elementProto[name] = implementation;
  }
};

// Positioning and pointer capture are meaningless in jsdom. These only have to
// exist and not throw.
stub('scrollIntoView', () => undefined);
stub('hasPointerCapture', () => false);
stub('setPointerCapture', () => undefined);
stub('releasePointerCapture', () => undefined);

/**
 * `matchMedia`, which jsdom does not implement at all.
 *
 * shadcn's sidebar asks it whether this is a phone. Everything under test here
 * is the desktop layout, so it answers no and never notifies — a component that
 * changed behaviour halfway through a test because a stub fired would be worse
 * than one that never varies.
 */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();

  // After unmounting, so no live provider is subscribed when the listeners go.
  // The session store is module state, which means it survives between tests in
  // a file — a test that signed in would otherwise leave the next one already
  // authenticated, and an assertion about being signed out would pass or fail
  // depending on the order the tests happened to run in.
  resetSessionStore();

  // Sonner's queue is module state too, and a toast raised by one test is
  // still mounted for the next one — which turns "no routing message was
  // shown" into a failure caused by the previous assertion passing.
  dismissToasts();

  localStorage.clear();
  sessionStorage.clear();
});
