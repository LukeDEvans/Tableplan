# Export my data + permanent history — Design & status

> **Status (2026-09-27):** implemented on branch `claude/optimistic-heisenberg-i77pwn`.
> Decisions (Luke, 2026-09-27): **manual** export only (no scheduled job) · **fix the
> history caps now** · attachments as **links only**.
> **Migration applied to production 2026-09-28** (`live_history`, least-privilege grants,
> advisor clean). History starts saving to the table once this branch is deployed.

Evidence labels: **[observed]** read in code · **[verified]** run and checked · **[inferred]**.

---

## 1. Why

Audit findings (2026-09-27) **[observed]**:

| Finding | Where |
|---|---|
| No way to download your data on the live site or the iOS app. The only export was one month of finance transactions (6 columns) plus a contacts vCard. | `finance-ui.js` `exportFinanceCsv`, `contacts.js` |
| Local JSON backups work **only on localhost**. | `writeLocalBackup`, `canUseLocalBackend` |
| Cloud snapshots are kept for about 3 days, have article text and podcast descriptions removed, and can't be downloaded. | `CLOUD_SNAPSHOT_*`, `snapshotPayload` |
| History was being **destroyed** by caps: media plays 60, article reads 2000, piano practice events 1000, AI chat 20 (browser only), finance month totals 36 months. | `media-history.js` `pushHistory`, `ARTICLE_HISTORY_CAP`, `music/events.js`, `CHAT_MAX_STORED`, `finance-ui.js` (both snapshot writers) |
| Bank transactions older than about 45 days: the ledger (`finance_transactions`) exists, but "feed" reads are the default and the read switch is gated. | FINANCE_TRANSACTIONS_DESIGN.md |

## 2. Export my data (Settings › Export My Data)

One zip, `live-export-YYYY-MM-DD.zip`, **derived at click time from the same in-memory
state**. There is no second "CSV collection" path that could drift from the real data.

| File | What |
|---|---|
| `live-export.json` | Lossless. `state` sits at the top level, so **Settings › Restore accepts it** **[verified: preview parsed, Full Restore enabled]**. Also contains `shadowSections` (the other household/personal view), `scopes`, and `relational` (finance ledger rows and history rows). |
| `csv/*.csv` | One file per record type, 50+ tables (see `EXPORT_TABLES`). Columns are discovered from the data, so a new field appears without code changes. Id→name lookups are added where they help. UTF-8 with BOM and CRLF line endings. Text that a spreadsheet would run as a formula gets a leading `'`. |
| `csv/household/`, `csv/personal/` | The scope-inactive copy of each toggleable section, built from the same table definitions. |
| `calendar.ics` | User-created events, with RRULE and EXDATE. Subscribed calendars are left out because they aren't your data. |
| `contacts.vcf` | Same builder as the Contacts page (`buildContactsVcf`). |
| `attachments.csv` | Every photo, receipt and attachment reference, **links only**. Embedded `data:` URLs are noted, not copied. |
| `manifest.json`, `README.txt` | Row counts per file, redacted keys, and notes (e.g. "stored history unreachable"). |

**Secrets are removed**, not exported: any string under a key matching
cookie/token/secret/password/api-key/access-key/authorization/credential. Their paths are
listed in `manifest.redactedKeys`. After a **full** restore from an export, re-enter those
logins in Settings. A merge restore doesn't touch them.

**Network reads, explicit trigger only:** one `finance_transactions` store sync, which
gives full ledger history even while finance reads the feed, and paged `live_history`
reads (keyset, capped at 200×1000 rows). Nothing runs on a timer.

Code: `data-export.js` (pure, in the fitness test's PURE_CORE),
`finance-ui.js` `financeExportTransactions`, `app.js` `exportMyData`.
iOS app: the file goes to the share sheet (Save to Files); browsers get a normal download.

## 3. Permanent history (`live_history`)

The capped in-state lists **stay** as the UI's "recent" window. Raising the caps would
grow every write of the synced JSONB sections, which is the egress lesson in CLAUDE.md.
Instead, each entry is **also appended once** to a per-user, append-only table.

| Kind | Source hook | Row id (idempotent) |
|---|---|---|
| `media_play` | `recordMediaHistory` | `mp:<kind>:<hash(id)>:<at>` (every play is its own row) |
| `article_read` | `recordArticleHistory` | `ar:<hash(id)>:<date>` |
| `practice_event` | `cadenceLogEvent` | `pe:<event id>` |
| `ai_chat` | `saveChatHistory` | `chat:<role>:<hash(role\|content)>` (content only; the app's context preamble is removed) |

- **Writer** (`history-log.js`): debounced (4 s), batched (200 rows), bounded queue
  (5000 rows, persisted in `live-history-queue-v1`, which is account-scoped and cleared on
  sign-out).
  - A 404, 401 or 403 disables sending for the session.
  - A 5xx or network error retries 3 times with backoff, then waits for the next user action.
  - A 400 halves the batch size to isolate the bad row, then drops only that row.
  - Rows are posted with `on_conflict=(user_id,id)` + `ignore-duplicates`, so a re-send is a no-op.
  - It never reads. There's no polling and no Realtime.
- **Backfill:** once per user after cloud hydration, the in-state history (60 media
  plays, 2000 article reads, 1000 practice events, and the stored chat) is queued. That's
  about 16 batched POSTs, one time.
- **RLS:** select, insert and delete on your own rows only. No update policy.

**Finance month totals:** the 36-month prune is **removed** from both writers. Each month
is about 1 KB. Finance deep-merge unions month keys, so an older device that still prunes
can't delete months it doesn't know about. **[inferred from finance-sync deep-merge]**

## 4. ARCHITECTURE §25 guardrails

1. **Why:** history was being destroyed (§1), and there was no way to get data out of the live app.
2. **Evidence:** four real history sources today, and one export consumer.
3. **Complexity:** two small pure modules plus one table. Removed: the idea of a per-feature CSV writer.
4. **Do-nothing cost:** history keeps being lost, and there's no portability.
5. **Reversibility:** drop the table and remove four one-line hooks. No state-schema change, and no `STATE_SCHEMA_VERSION` bump (no new state keys).
6. **Account scope:** `live_history` is per user; the queue key is in `ACCOUNT_SCOPED_STORAGE_KEYS`.
7. **Portability:** the modules are pure with injected I/O. The table is plain Postgres.
8. **Revisit trigger:** a scheduled or automatic export request, or history needed *in the app* (a "listening history" page) — at that point, read from the table.

## 5. Not covered (logged in ISSUES.md)

- Music you uploaded yourself (browser database `live-music`) is only on the device and isn't in the export.
- A new chat turn identical to an earlier one (same role and text) collapses into one history row.
- Finance's *read* switch to the durable ledger remains its own gated decision. The export already includes the full ledger.
