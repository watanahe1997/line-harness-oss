import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rentalMigrationPlan } from './migration-plan.js';

const account = 'e069a5c880e0785cfd3c48ab25d96be0', database = 'dbccb8db-7a3a-43bd-a900-cc3846fdee9a';
const config = readFileSync(join(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
const oauth = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!oauth) throw new Error('Run wrangler whoami/login first');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`;
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + oauth, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parsed = await response.json() as any;
  if (!response.ok || !parsed.success) throw new Error(JSON.stringify(parsed.errors?.map((error: any) => ({ code: error.code, message: error.message })) ?? response.status));
  return parsed.result;
}
const plan = rentalMigrationPlan();
if (process.argv[2] !== 'apply') {
  console.log(JSON.stringify(plan.map(({ name, statements, skippedMileageBackfills }) => ({ name, statements: statements.length, skippedMileageBackfills })), null, 2));
} else {
  const bookmark = await api('/time_travel/bookmark');
  if (!bookmark.bookmark) throw new Error('D1 recovery bookmark unavailable; no migration applied');
  const before = await api('/query', { sql: `SELECT (SELECT COUNT(*) FROM friends) friends, (SELECT COUNT(*) FROM rental_quote_requests) requests,
    (SELECT COUNT(*) FROM rental_estimates) estimates, (SELECT COUNT(*) FROM rental_applications) applications,
    (SELECT COUNT(*) FROM messages_log) messages, (SELECT COUNT(*) FROM chats) chats,
    (SELECT COUNT(DISTINCT friend_id) FROM chats) unique_chats` });
  mkdirSync('.wrangler/rental-upgrade', { recursive: true });
  const recoveryTimestamp = new Date().toISOString();
  writeFileSync('.wrangler/rental-upgrade/recovery-' + recoveryTimestamp.replace(/[:.]/g, '-') + '.json', JSON.stringify({ timestamp: recoveryTimestamp, account, database, bookmark: bookmark.bookmark, counts: before[0].results[0] }, null, 2), { flag: 'wx' });
  await api('/query', { sql: 'CREATE TABLE IF NOT EXISTS rental_schema_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)' });
  const applied = (await api('/query', { sql: 'SELECT name, sha256 FROM rental_schema_migrations' }))[0].results;
  for (const file of plan) {
    const prior = applied.find((row: any) => row.name === file.name);
    if (prior) { if (prior.sha256 !== file.sha256) throw new Error('Migration changed: ' + file.name); continue; }
    for (const statement of file.statements) {
      try { await api('/query', { sql: statement }); }
      catch (error) {
        if (!/duplicate column name|already exists/i.test(String(error))) throw error;
      }
    }
    await api('/query', { sql: 'INSERT INTO rental_schema_migrations(name, sha256, applied_at) VALUES (?, ?, ?)', params: [file.name, file.sha256, new Date().toISOString()] });
    console.log('Applied ' + file.name);
  }
  // The prior deployment used bootstrap.sql rather than a migration ledger.
  // Record the installed baseline too, so future ordinary CI does not replay it.
  await api('/query', { sql: 'CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)' });
  const installed = JSON.parse(readFileSync('packages/db/bootstrap-meta.json', 'utf8')).includedMigrations as string[];
  for (const name of installed) await api('/query', { sql: 'INSERT OR IGNORE INTO _migrations(name, applied_at) VALUES (?, ?)', params: [name, new Date().toISOString()] });
  const after = await api('/query', { sql: `SELECT (SELECT COUNT(*) FROM friends) friends, (SELECT COUNT(*) FROM rental_quote_requests) requests,
    (SELECT COUNT(*) FROM rental_estimates) estimates, (SELECT COUNT(*) FROM rental_applications) applications,
    (SELECT COUNT(*) FROM messages_log) messages, (SELECT COUNT(*) FROM chats) chats,
    (SELECT COUNT(DISTINCT friend_id) FROM chats) unique_chats,
    (SELECT COUNT(*) FROM rental_estimates WHERE sent_at IS NOT NULL AND published_snapshot IS NULL) missing_snapshots,
    (SELECT COUNT(*) FROM rental_estimates WHERE sent_at IS NOT NULL AND json_extract(published_snapshot, '$.paymentTotal') IS NOT payment_total) changed_legacy_amounts,
    (SELECT COUNT(*) FROM mileage_ledger) mileage_grants,
    (SELECT COUNT(*) FROM mileage_rules WHERE is_active = 1) active_mileage_rules,
    (SELECT COUNT(*) FROM auto_replies WHERE id = 'builtin-mileage-wallet-keyword' AND is_active = 1) active_mileage_reply` });
  console.log(JSON.stringify({ before: before[0].results[0], after: after[0].results[0], recoveryRecorded: true }, null, 2));
  const previous = before[0].results[0], current = after[0].results[0];
  if (['friends', 'requests', 'estimates', 'applications', 'messages'].some((key) => current[key] < previous[key]) || current.unique_chats < previous.unique_chats || current.missing_snapshots || current.changed_legacy_amounts || current.mileage_grants || current.active_mileage_rules || current.active_mileage_reply) throw new Error('Post-migration verification failed; inspect the saved recovery bookmark before deploying');
}
