import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from './use-online-status';

/**
 * You are offline — US-31, AC5.
 *
 * Persistent while it lasts, and it clears itself on reconnect. There is no
 * dismiss control on purpose: a banner the user can close is a banner they will
 * close, and then wonder why nothing saves.
 *
 * `role="status"` rather than `alert`. Losing a connection is worth announcing,
 * but not worth interrupting whatever a screen reader is in the middle of —
 * `alert` is assertive and would cut across a sentence.
 *
 * It uses the urgency ramp's amber, which is the one legitimate extension of
 * the rationed-colour rule beyond SLA: this genuinely is "something needs your
 * attention now", and it is the only banner in the product.
 */
export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const online = useOnlineStatus();

  if (online) {
    return null;
  }

  return (
    <div
      role="status"
      className="bg-sla-warn-soft text-sla-warn border-sla-warn/30 flex items-center justify-center gap-2 border-b px-4 py-2"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      {/* Text as well as the icon, always. */}
      <span className="text-meta font-medium">{t('states.offlineBanner')}</span>
    </div>
  );
}
