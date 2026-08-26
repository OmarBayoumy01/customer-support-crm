import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/**
 * What a caught render error looks like — US-25.
 *
 * Written as an interface state rather than a stack trace. The person reading
 * it cannot fix the bug, so the screen tells them the two things they *can*
 * act on: try again, or quote the reference when they report it.
 */
function CrashScreen({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main
      role="alert"
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-page font-semibold">{t('errors.crashTitle')}</h1>
      <p className="text-ink-muted text-body">{t('errors.crashBody')}</p>
      <Button onClick={onRetry}>{t('errors.tryAgain')}</Button>
    </main>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches a render error inside a route so it does not blank the whole app.
 *
 * Placed **inside** the shell rather than around it, so a page that throws
 * leaves the sidebar and header standing and the user can navigate away. An
 * error boundary at the very root turns one broken screen into a white page,
 * which is a worse outcome for the same bug.
 *
 * A class, because React still offers no hook for this.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged rather than swallowed. There is no error reporting service yet —
    // that is P15's — so the console is where this goes, deliberately and
    // visibly, instead of disappearing.
    console.error('Route render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <CrashScreen
          onRetry={() => {
            this.setState({ hasError: false });
          }}
        />
      );
    }

    return this.props.children;
  }
}
