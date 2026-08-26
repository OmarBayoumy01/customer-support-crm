import { useTranslation } from 'react-i18next';
import type { DependencyStatus } from '@crm/shared';

import { cn } from '@/lib/utils';
import { useServiceHealth } from './use-service-health';

/**
 * One dependency, named and stated.
 *
 * **Quiet when it is fine.** This is the rationed-colour rule applied honestly:
 * a healthy service gets no colour at all, so the strip is invisible until it
 * has something to say. Only "down" reaches for the ramp, and when it does it
 * is the only saturated thing on the screen.
 */
function Dependency({
  name,
  status,
}: {
  name: string;
  status: DependencyStatus;
}): React.JSX.Element {
  const { t } = useTranslation();
  const down = status.status !== 'up';

  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', down ? 'bg-sla-breach' : 'bg-white/35')}
      />
      <span className="text-meta text-white/70">{name}</span>
      {/*
        The state in words as well as the dot. A coloured dot on its own is
        exactly what the definition of done forbids.
      */}
      <span className={cn('text-meta ms-auto', down ? 'text-sla-breach' : 'text-white/45')}>
        {down ? t('signIn.status.down') : t('signIn.status.up')}
      </span>
      {status.latencyMs === undefined || down ? null : (
        <span className="tabular text-meta w-10 text-end text-white/30">{status.latencyMs}ms</span>
      )}
    </li>
  );
}

/**
 * The platform's own status, on its front door.
 *
 * Renders nothing at all when it cannot reach the API — see `useServiceHealth`.
 * That is deliberate: absence is not a claim, whereas a red "unreachable" badge
 * would tell someone their password was the problem when it was not.
 */
export function ServiceStatus(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { data } = useServiceHealth();

  if (!data) {
    return null;
  }

  const dependencies = Object.entries(data.dependencies);

  if (dependencies.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-white/10 pt-4">
      <p className="text-meta mb-2 font-medium tracking-wide text-white/45 uppercase">
        {t('signIn.status.title')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {dependencies.map(([name, status]) => (
          <Dependency
            key={name}
            name={t(`signIn.status.${name}`, { defaultValue: name })}
            status={status}
          />
        ))}
      </ul>
    </div>
  );
}
