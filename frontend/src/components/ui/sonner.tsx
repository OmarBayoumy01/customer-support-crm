import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { isRtl } from '@/i18n';

/**
 * The toast host — US-32.
 *
 * shadcn generates this reading the theme from `next-themes`. That dependency
 * was removed: this app has one theme (dark mode is V2, explicitly out of scope
 * for US-26), so pulling in a theme provider to hard-code "light" would be a
 * package to maintain in exchange for nothing.
 *
 * **Bottom-start, not bottom-end (AC4).** The primary action on this product's
 * dense screens — the reply composer's send button, a form's submit — sits at
 * the inline *end*. Stacking toasts there would cover the control the user just
 * pressed and is about to press again. The side flips with the language, so it
 * stays out of the way in Arabic too.
 *
 * `visibleToasts` caps the stack; sonner collapses the rest, which is the
 * "older ones collapse" half of AC4.
 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  const rtl = isRtl(document.documentElement.lang);

  return (
    <Sonner
      theme="light"
      className="toaster group"
      position={rtl ? 'bottom-right' : 'bottom-left'}
      dir={rtl ? 'rtl' : 'ltr'}
      visibleToasts={3}
      // Sonner renders into an aria-live region of its own, which is what
      // satisfies AC5 — a toast is announced rather than only drawn.
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
