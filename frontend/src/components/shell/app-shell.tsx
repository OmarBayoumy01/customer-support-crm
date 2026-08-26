import { useAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isRtl } from '@/i18n';

import { mobileNavOpenAtom } from '@/app/shell-state';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Header } from './header';
import { Sidebar } from './sidebar';

/**
 * Sidebar, header, content — US-28.
 *
 * **AC6 costs nothing here.** The sidebar is first in the DOM inside a flex
 * row, and a flex row respects the document's `dir`, so in Arabic it moves to
 * the right on its own. Every inset in the tree is a logical property, so the
 * mirror is a swap rather than a second stylesheet. There is a test that fails
 * if a physical direction appears in a rendered class.
 *
 * The main region scrolls, not the page: an agent working a long ticket thread
 * should not lose the header and the queue they came from.
 */
export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [mobileOpen, setMobileOpen] = useAtom(mobileNavOpenAtom);

  /**
   * Radix's `side` is physical, so the logical one is computed. The drawer has
   * to come from the same edge the sidebar lives on, and that edge changes with
   * the language — a drawer sliding in from the left in Arabic would be coming
   * from the far side of the screen.
   */
  const drawerSide = isRtl(i18n.language) ? ('right' as const) : ('left' as const);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-ground flex h-screen overflow-hidden">
        {/* Below `lg` the sidebar becomes a drawer — see the sheet below. */}
        <Sidebar className="hidden lg:flex" />

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side={drawerSide} className="w-60 p-0">
            <SheetTitle className="sr-only">{t('nav.label')}</SheetTitle>
            <Sidebar className="w-full border-e-0" />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header />

          {/*
            `min-w-0` on the column above and `overflow-auto` here are what stop
            a wide data table from stretching the shell instead of scrolling
            inside it — the single most common way a layout like this breaks.
          */}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
