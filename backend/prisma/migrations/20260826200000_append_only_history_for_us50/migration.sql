-- US-50, AC4 — history is append-only, and it is the database that says so.
--
-- Enforcing this in the application would mean every future service, script and
-- migration remembering. Enforcing it here means it is true for psql, for a
-- misdirected Prisma call, and for whatever writes to this database in three
-- years. US-6's comment on TicketHistory already said an audit trail you can
-- edit is not an audit trail; this makes that a guarantee rather than an
-- intention.
--
-- Hand-written: there is no schema change here, so `prisma migrate dev` has
-- nothing to diff and would generate an empty migration.

-- No SQLSTATE is set on purpose. The obvious choice, `restrict_violation`, sits
-- in PostgreSQL's integrity-constraint class, and Prisma renders that whole
-- class as "Foreign key constraint violated" — the message below never reaches
-- the caller, and the one place it matters is a developer working out why their
-- write was refused. The default P0001 keeps the sentence.

CREATE OR REPLACE FUNCTION history_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'The % table is append-only: entries cannot be edited', TG_TABLE_NAME;
  END IF;

  -- DELETE is refused only while the parent still exists.
  --
  -- That distinction is what keeps a legitimate cascade working. When a ticket
  -- is genuinely purged, PostgreSQL removes the parent row first and the
  -- cascade fires afterwards, so by the time this runs the ticket is already
  -- gone and the history has nothing left to describe. A DELETE aimed straight
  -- at a live ticket's history is somebody quietly editing the record, and that
  -- is what this refuses.
  IF EXISTS (SELECT 1 FROM "Ticket" WHERE id = OLD."ticketId") THEN
    RAISE EXCEPTION 'The % table is append-only: entries cannot be deleted', TG_TABLE_NAME;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticket_history_append_only ON "TicketHistory";

CREATE TRIGGER ticket_history_append_only
  BEFORE UPDATE OR DELETE ON "TicketHistory"
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();
