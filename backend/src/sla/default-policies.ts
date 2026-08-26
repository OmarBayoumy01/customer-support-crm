import type { CreateSlaPolicy } from '@crm/shared';

/**
 * The policies a fresh installation starts with — US-67, and the MVP's
 * simplification of it.
 *
 * `.squad/plans/00-mvp-scope.md` defers the management UI (US-70), so these are
 * seeded rather than configured. They are ordinary policies: US-70 will edit
 * and delete them like any other, and nothing here is privileged.
 *
 * Targets are deliberately round numbers a person can hold in their head. They
 * are also a **24/7 clock** — US-75's business-hours calendar is deferred, so
 * `businessHoursOnly` is false on every one of these. Setting it true and
 * having nothing honour it would make a four-hour target silently mean four
 * hours of wall clock anyway, and the day US-75 lands every historic ticket
 * would appear to have been measured wrongly.
 */

/**
 * The ladder every default policy carries — the three rungs US-71 needs.
 *
 * Only the resolution clock is laddered. A first-response target is usually
 * minutes, and a rung at 75% of fifteen minutes fires while the agent is still
 * reading the ticket.
 */
function standardLadder(): CreateSlaPolicy['escalationSteps'] {
  return [
    // US-71 AC1 — the agent who owns it hears first.
    {
      sequence: 0,
      clock: 'RESOLUTION',
      atPercent: 75,
      notify: 'ASSIGNEE',
      changeStatusToEscalated: false,
    },
    // US-71 AC2 — still at risk, so the department manager is told.
    {
      sequence: 1,
      clock: 'RESOLUTION',
      atPercent: 90,
      notify: 'DEPARTMENT_MANAGER',
      changeStatusToEscalated: false,
    },
    // US-71 AC3 — the target has passed. This is the one rung that moves the
    // ticket's status, which is why AC5's "do not escalate twice" has something
    // definite to check.
    {
      sequence: 2,
      clock: 'RESOLUTION',
      atPercent: 100,
      notify: 'DEPARTMENT_MANAGER',
      changeStatusToEscalated: true,
    },
  ];
}

export const DEFAULT_SLA_POLICIES: readonly CreateSlaPolicy[] = [
  {
    nameEn: 'Urgent',
    nameAr: 'عاجلة',
    priority: 'URGENT',
    firstResponseMinutes: 15,
    resolutionMinutes: 4 * 60,
    businessHoursOnly: false,
    isActive: true,
    escalationSteps: standardLadder(),
  },
  {
    nameEn: 'High',
    nameAr: 'عالية',
    priority: 'HIGH',
    firstResponseMinutes: 60,
    resolutionMinutes: 8 * 60,
    businessHoursOnly: false,
    isActive: true,
    escalationSteps: standardLadder(),
  },
  {
    nameEn: 'Medium',
    nameAr: 'متوسطة',
    priority: 'MEDIUM',
    firstResponseMinutes: 4 * 60,
    resolutionMinutes: 24 * 60,
    businessHoursOnly: false,
    isActive: true,
    escalationSteps: standardLadder(),
  },
  {
    nameEn: 'Low',
    nameAr: 'منخفضة',
    priority: 'LOW',
    firstResponseMinutes: 8 * 60,
    resolutionMinutes: 72 * 60,
    businessHoursOnly: false,
    isActive: true,
    escalationSteps: standardLadder(),
  },
  /**
   * AC3 — the VIP override.
   *
   * Matches on VIP alone and on no priority, which is exactly the case the
   * weighting exists for: it sets one matcher where "Urgent" sets one, but VIP
   * is worth more, so a VIP's low-priority ticket is still treated as urgent.
   * That is the promise a VIP contract makes.
   */
  {
    nameEn: 'VIP',
    nameAr: 'كبار العملاء',
    customerIsVip: true,
    firstResponseMinutes: 15,
    resolutionMinutes: 4 * 60,
    businessHoursOnly: false,
    isActive: true,
    escalationSteps: standardLadder(),
  },
];
