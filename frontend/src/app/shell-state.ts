import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * Shell UI state — US-28.
 *
 * Jotai rather than context for this, and the distinction is worth stating:
 * `AuthContext` holds the *session*, which is one object read by nearly
 * everything. This is a handful of unrelated booleans read by two components
 * each, and putting them in a context would re-render the whole tree every time
 * somebody opened a menu.
 *
 * Nothing here is server state. Anything fetched belongs to TanStack Query.
 */

/**
 * Whether the sidebar is collapsed to icons — AC3, which requires it to survive
 * navigation *and* reload.
 *
 * `SidebarProvider` is driven from this rather than from shadcn's own cookie,
 * so the app has one storage story instead of two.
 *
 * `localStorage` is right for this where it was wrong for the access token: a
 * layout preference is not a credential, and the worst an attacker can do with
 * it is find out somebody likes a narrow sidebar.
 */
export const sidebarCollapsedAtom = atomWithStorage('crm:sidebar-collapsed', false);

/** Whether the global search palette is open. */
export const searchOpenAtom = atom(false);

/**
 * Whether the ticket workspace's context column is collapsed — US-45, AC5.
 *
 * Persisted for the same reason and with the same caveat as the sidebar: it is
 * a layout preference, not a credential. Kept here rather than in the ticket
 * feature because it is shell state — it describes how the person likes to
 * work, not anything about a particular ticket.
 */
export const ticketContextCollapsedAtom = atomWithStorage('crm:ticket-context-collapsed', false);
