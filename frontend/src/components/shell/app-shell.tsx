import { useAtom } from 'jotai';
import type { ReactNode } from 'react';

import { sidebarCollapsedAtom } from '@/app/shell-state';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Header } from './header';
import { AppSidebar } from './sidebar';

/**
 * Sidebar, header, content — US-28.
 *
 * Built on shadcn's `SidebarProvider`, which owns the collapse state, the
 * mobile drawer, the icon rail and the `⌘B` shortcut. Those were three separate
 * hand-rolled mechanisms before, each of which had to be kept in step with the
 * others; now they are one.
 *
 * **The persisted preference is still ours.** The provider is driven as a
 * controlled component from `sidebarCollapsedAtom` rather than from shadcn's
 * cookie, because AC3 wants the choice to survive a reload and the atom already
 * did that — and because the app has one storage story, not two.
 *
 * **AC6 costs nothing.** `ui/sidebar.tsx` resolves `side` to
 * `inset-inline-start`, so in Arabic the panel and its drawer move to the right
 * with no directional style in this tree. There is a test that fails if a
 * physical direction appears in a rendered class.
 */
export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(open) => {
          setCollapsed(!open);
        }}
      >
        <AppSidebar />

        <SidebarInset className="min-w-0">
          <Header />

          {/*
            The main region scrolls, not the page: an agent working a long
            ticket thread should not lose the header and the queue they came
            from.

            `min-w-0` on the inset and `overflow-auto` here are what stop a wide
            data table from stretching the shell instead of scrolling inside it
            — the single most common way a layout like this breaks.
          */}
          <main className="min-w-0 flex-1 overflow-auto">
            {/*
              The content gutter. Generous rather than tight, and capped: a
              queue stretched across an ultrawide monitor is unreadable, and a
              ticket thread at that width is worse. `mx-auto` centres what is
              left.
            */}
            <div className="mx-auto w-full max-w-[100rem] p-4 md:p-6">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
