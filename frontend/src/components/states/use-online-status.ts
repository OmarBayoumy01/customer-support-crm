import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a connection — US-31, AC5.
 *
 * `navigator.onLine` is only ever trustworthy in one direction: `false` reliably
 * means there is no network, while `true` means "an interface is up", which is
 * not the same as the API being reachable. That is fine for what this drives —
 * a banner saying "you are offline" must not be wrong, and one that clears
 * slightly optimistically costs nothing, because the next failed request will
 * say so properly through `ErrorState`.
 *
 * Read at mount rather than seeded from the initial value, so a tab restored
 * from the background does not start with a stale answer.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };

    update();

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
