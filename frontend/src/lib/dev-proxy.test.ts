/**
 * The dev proxy against the paths the client actually calls.
 *
 * This exists because of a bug every other test was structurally unable to
 * catch. `/portal` was missing from `vite.config.ts`, so in a real browser every
 * portal request went to the Vite dev server instead of the API: a GET came back
 * as `index.html` with status 200, and a POST came back 404. The whole customer
 * portal was unreachable in the running application while its suites stayed
 * green, because jsdom tests stub the axios adapter and never touch the proxy.
 *
 * It reads the sources as **text** rather than importing them. Importing the
 * config would pull in esbuild and Tailwind, which will not run against the
 * TextEncoder jsdom installs, and giving this one file the node environment
 * breaks the shared setup that expects a DOM. Reading the file has neither
 * problem, and a proxy table is exactly the kind of thing worth checking against
 * the source of truth instead of a copy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const CONFIG = join(SRC, '..', 'vite.config.ts');
const ROUTER = join(SRC, 'app', 'router.tsx');

/** The proxy table, read out of the config. */
function proxyTable(): { path: string; isAlsoARoute: boolean }[] {
  const source = readFileSync(CONFIG, 'utf8');
  const table = source.match(/const API_PREFIXES = \[([\s\S]*?)\] as const;/);

  if (table === null) {
    throw new Error('API_PREFIXES is not in vite.config.ts in the expected shape');
  }

  return [
    ...table[1]!.matchAll(/\{\s*path:\s*'([^']+)',\s*isAlsoARoute:\s*(true|false)\s*\}/g),
  ].map((entry) => ({ path: entry[1]!, isAlsoARoute: entry[2] === 'true' }));
}

/** Every `.ts`/`.tsx` file under `src`, tests excluded. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    const isSource = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);

    return isSource ? [path] : [];
  });
}

/**
 * The first path segment of every API call in the client.
 *
 * Matched on the call itself — `apiGet('/x')`, `http.post('/x')` — rather than on
 * every string that looks like a path, so a route like `/dashboard` is not
 * mistaken for an endpoint.
 */
function calledPrefixes(): Set<string> {
  const call =
    /(?:apiGet|apiPost|apiPatch|apiDelete|(?:http|refreshHttp)\.(?:get|post|patch|put|delete))(?:<[^>]*>)?\(\s*[`'"](\/[a-z][a-z-]*)/g;

  const found = new Set<string>();

  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(call)) {
      found.add(match[1]!);
    }
  }

  return found;
}

/** The first segment of every route the SPA owns. */
function routeSegments(): Set<string> {
  const source = readFileSync(ROUTER, 'utf8');

  return new Set([...source.matchAll(/path="(\/[a-z][a-z-]*)/g)].map((match) => match[1]!));
}

describe('the development proxy', () => {
  test('every API prefix the client calls is proxied', () => {
    const proxied = new Set(proxyTable().map((entry) => entry.path));
    const missing = [...calledPrefixes()].filter((prefix) => !proxied.has(prefix)).sort();

    // The failure this catches is silent in the browser: an unproxied GET is
    // answered with the SPA's own HTML at status 200, and the client falls over
    // on JSON that is really a web page.
    expect(missing).toEqual([]);
  });

  test('the client actually calls everything that is proxied', () => {
    const called = calledPrefixes();
    const unused = proxyTable()
      .map((entry) => entry.path)
      .filter((path) => !called.has(path))
      .sort();

    // The other direction, so the table does not accumulate entries for
    // endpoints nothing asks for.
    expect(unused).toEqual([]);
  });

  test('a prefix that is also a page bypasses the proxy for HTML', () => {
    const routes = routeSegments();

    const routesWithoutBypass = proxyTable()
      .filter((entry) => routes.has(entry.path) && !entry.isAlsoARoute)
      .map((entry) => entry.path);

    /**
     * One direction only, and deliberately.
     *
     * `/tickets` and `/portal` are endpoints *and* pages: without the bypass,
     * opening one in a new tab proxies the navigation to the API and the browser
     * downloads JSON instead of rendering the app. That is the bug worth
     * failing on.
     *
     * The reverse is harmless. `/customers` carries the flag while its page is
     * still unbuilt — an HTML request there renders the SPA's own 404, which is
     * the right answer, and the flag is already correct for the story that adds
     * the page.
     */
    expect(routesWithoutBypass).toEqual([]);
  });
});
