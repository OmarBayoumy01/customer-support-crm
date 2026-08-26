import { BrowserRouter } from 'react-router';

import { AppProviders } from './app/providers';
import { AppRoutes } from './app/router';

/**
 * The application root.
 *
 * `BrowserRouter` sits outside the providers so `useLogin` can navigate; the
 * tests mount `MemoryRouter` around the same `AppProviders` instead.
 */
export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
