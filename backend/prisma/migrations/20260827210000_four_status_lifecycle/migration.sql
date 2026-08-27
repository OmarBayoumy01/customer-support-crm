-- Four-status lifecycle: NEW, WAITING_FOR_AGENT, WAITING_FOR_CUSTOMER, RESOLVED.
--
-- Seven statuses became four. Postgres cannot drop a value from an enum, so the
-- type is recreated and the column rewritten through an explicit mapping. No row
-- is deleted and no history is rewritten.
--
-- Written by hand rather than generated, because `prisma migrate dev` would have
-- offered to reset the database: it cannot know what an OPEN ticket should become.

-- ---------------------------------------------------------------------------
-- 1. No escalation is lost when the status stops carrying it.
--
-- Escalation moves out of the status and into `escalatedAt`/`escalatedToId`,
-- which the sweep has always written — except for rows escalated before those
-- columns were filled, and any escalated by hand. Backfilled from the earliest
-- ESCALATED history entry, falling back to `updatedAt`, *before* the status is
-- mapped away. Without this step the escalated tickets would silently become
-- un-escalated.
-- ---------------------------------------------------------------------------
UPDATE "Ticket" t
SET "escalatedAt" = COALESCE(
  (
    SELECT MIN(h."createdAt")
    FROM "TicketHistory" h
    WHERE h."ticketId" = t.id
      AND (h."eventType" = 'ESCALATED' OR h."toValue" = 'ESCALATED')
  ),
  t."updatedAt"
)
WHERE t.status = 'ESCALATED'
  AND t."escalatedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The new type.
-- ---------------------------------------------------------------------------
CREATE TYPE "TicketStatus_new" AS ENUM ('NEW', 'WAITING_FOR_AGENT', 'WAITING_FOR_CUSTOMER', 'RESOLVED');

-- ---------------------------------------------------------------------------
-- 3. The mapping.
--
-- Three of the seven are unambiguous. OPEN and ESCALATED are not — either could
-- be waiting on us or on the customer — so the mapping asks **who spoke last**
-- rather than guessing. US-6 denormalised `lastAgentReplyAt` and
-- `lastCustomerReplyAt` for exactly this comparison.
--
--   NEW              → NEW                    identical meaning
--   PENDING_CUSTOMER → WAITING_FOR_CUSTOMER   identical meaning
--   PENDING_INTERNAL → WAITING_FOR_AGENT      internal work is still our turn
--   OPEN             → last word decides      agent spoke last ⇒ their turn
--   ESCALATED        → last word decides      escalation is not a turn
--   CLOSED           → RESOLVED               the only terminal status left;
--                                             `closedAt` still says which
--   RESOLVED         → RESOLVED               identical
--
-- The default arm is WAITING_FOR_AGENT: if we cannot tell, the safe answer is
-- that the ticket is on our desk, not the customer's.
-- ---------------------------------------------------------------------------
ALTER TABLE "Ticket"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE "TicketStatus_new"
  USING (
    CASE
      WHEN status = 'NEW' THEN 'NEW'
      WHEN status = 'RESOLVED' THEN 'RESOLVED'
      WHEN status = 'CLOSED' THEN 'RESOLVED'
      WHEN status = 'PENDING_CUSTOMER' THEN 'WAITING_FOR_CUSTOMER'
      WHEN status = 'PENDING_INTERNAL' THEN 'WAITING_FOR_AGENT'
      WHEN "lastAgentReplyAt" IS NOT NULL
        AND "lastAgentReplyAt" > COALESCE("lastCustomerReplyAt", "createdAt")
        THEN 'WAITING_FOR_CUSTOMER'
      ELSE 'WAITING_FOR_AGENT'
    END
  )::"TicketStatus_new";

-- ---------------------------------------------------------------------------
-- 4. Swap the types over and restore the default.
--
-- The seven indexes on `status` are rebuilt by the column rewrite above; none of
-- their definitions change, so they are not touched here.
-- ---------------------------------------------------------------------------
DROP TYPE "TicketStatus";

ALTER TYPE "TicketStatus_new" RENAME TO "TicketStatus";

ALTER TABLE "Ticket" ALTER COLUMN status SET DEFAULT 'NEW';

-- ---------------------------------------------------------------------------
-- TicketHistory is deliberately untouched.
--
-- It is append-only, enforced by the trigger US-50's AC4 added, and its
-- `fromValue`/`toValue` are text. Rows written before this migration say OPEN and
-- ESCALATED and always will — which is correct, because that is what happened.
-- The clients keep the retired labels so those entries still render.
-- ---------------------------------------------------------------------------
