import { useEffect, useState } from 'react';

/**
 * The current time, re-rendering on an interval — US-69, AC5.
 *
 * "The countdown updates without a refresh" needs something to make the
 * component render again; the SLA numbers themselves are pure functions of a
 * deadline and a now, and this supplies the now.
 *
 * A hook rather than a context publishing one shared tick: two timers in a
 * header is two intervals, which is not a problem worth infrastructure. If a
 * screen ever renders fifty of these, that is when a shared tick earns its
 * keep.
 *
 * The interval is cleared on unmount, so a ticket left open and navigated away
 * from does not keep a timer alive.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, intervalMs);

    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
