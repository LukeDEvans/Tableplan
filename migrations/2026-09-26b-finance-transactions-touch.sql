-- Follow-up to 2026-09-26-finance-transactions.sql (adversarial review, LOW):
-- the touch trigger bumped updated_at on EVERY merge-duplicates upsert, so each
-- daily ingest re-stamped every row in the 45–90 day pull and every client's
-- incremental sync re-downloaded all of them. Only bump updated_at when a column
-- that clients read actually changed; last_seen_at alone is bookkeeping.
--
-- ✅ APPLIED to production 2026-09-26 (MCP apply_migration "finance_transactions_touch_on_change"),
-- at Luke's request. Verified in a rolled-back transaction: a last_seen_at-only update
-- kept updated_at; an amount change bumped it. No rows left behind. Idempotent.

create or replace function public.finance_transactions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.origin, new.account_id, new.posted, new.amount, new.description, new.pending,
      new.status, new.superseded_by, new.import_label, new.import_batch)
     is not distinct from
     (old.origin, old.account_id, old.posted, old.amount, old.description, old.pending,
      old.status, old.superseded_by, old.import_label, old.import_batch)
  then
    new.updated_at := old.updated_at;   -- only last_seen_at (or nothing) changed
  else
    new.updated_at := now();
  end if;
  return new;
end $$;
