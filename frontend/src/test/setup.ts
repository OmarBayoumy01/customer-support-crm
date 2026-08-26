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

afterEach(() => {
  cleanup();

  // After unmounting, so no live provider is subscribed when the listeners go.
  // The session store is module state, which means it survives between tests in
  // a file — a test that signed in would otherwise leave the next one already
  // authenticated, and an assertion about being signed out would pass or fail
  // depending on the order the tests happened to run in.
  resetSessionStore();

  localStorage.clear();
  sessionStorage.clear();
});
