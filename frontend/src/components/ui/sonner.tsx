import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Toast host — US-32.
 *
 * shadcn generates this reading the theme from `next-themes`. That dependency
 * was removed: this app has one theme (dark mode is V2, explicitly out of scope
 * for US-26), so pulling in a theme provider to hard-code "light" would be a
 * package to maintain in exchange for nothing.
 *
 * Positioned bottom-**end** rather than bottom-right: in Arabic the toast
 * belongs on the side the eye returns to.
 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-right"
      dir="auto"
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
