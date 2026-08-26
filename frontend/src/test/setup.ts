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

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
