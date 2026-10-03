import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { splitSqlStatements, stripSqlComments } from '../../packages/update-engine/src/sql-statements.js';

export function rentalMigrationPlan() {
  // This commit records the exact schema used before this upgrade.
  const baseline = JSON.parse(execFileSync('git', ['show', '49aea3b:packages/db/bootstrap-meta.json'], { encoding: 'utf8' }));
  const existing = new Set<string>(baseline.includedMigrations);
  return readdirSync('packages/db/migrations').filter((file) => file.endsWith('.sql') && !existing.has(file)).sort().map((name) => {
    const sql = readFileSync('packages/db/migrations/' + name, 'utf8').replace(/\r\n/g, '\n');
    const all = splitSqlStatements(sql);
    // The rental business has no mileage scheme. Install its schema and rules,
    // but do not reinterpret historical customer actions as awarded points.
    const statements = name === '062_mileage_admin_and_activity_rules.sql'
      ? all.filter((statement) => !/INSERT\s+OR\s+IGNORE\s+INTO\s+(engagement_events|mileage_ledger)\b/i.test(stripSqlComments(statement))) : all;
    if (name === '061_mileage_foundation.sql') statements.push("UPDATE mileage_programs SET status = 'paused' WHERE id = 'default'");
    return { name, sha256: createHash('sha256').update(sql).update('\nrental-policy-v1').digest('hex'), statements, skippedMileageBackfills: all.length - statements.length };
  });
}
