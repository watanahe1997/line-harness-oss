import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { rentalMigrationPlan } from './migration-plan.js';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
describe('upgrade from the current production schema (no customer data)', () => {
  test('preserves quoted amounts and custom rental tables, without awarding unsolicited mileage', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(readFileSync('packages/db/test/fixtures/rental-production-schema-2026-10-03.sql', 'utf8'));
      db.exec(`INSERT INTO friends(id,line_user_id,created_at,updated_at) VALUES ('test','test','2026-09-01','2026-09-01');
        INSERT INTO rental_quote_requests(id,friend_id,property_name,desired_move_in_date,nickname,has_pets,needs_parking,has_motorbike,needs_bicycle_parking,created_at,updated_at) VALUES ('request','test','test','2026-11-01','test',0,0,0,0,'2026-09-01','2026-09-01');
        INSERT INTO rental_estimates(id,request_id,room_number,sort_order,payment_total,rent,brokerage_fee,cashback,sent_at,created_at,updated_at) VALUES ('estimate','request','101',0,148000,80000,88000,5000,'2026-09-01','2026-09-01','2026-09-01');
        INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES ('msg','test','incoming','text','hello','2026-09-01');`);
      const plan = rentalMigrationPlan(); expect(plan.length).toBeGreaterThan(20);
      for (const file of plan) for (const statement of file.statements) {
        try { db.exec(statement); } catch (error) { if (!/duplicate column name|already exists/i.test(String(error))) throw new Error(file.name + ': ' + String(error)); }
      }
      const row: any = db.prepare('SELECT * FROM rental_estimates WHERE id = ?').get('estimate');
      expect(row.payment_total).toBe(148000); expect(JSON.parse(row.published_snapshot)).toMatchObject({ paymentTotal: 148000, rent: 80000, cashback: 5000, pricingVersion: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM rental_estimate_versions').get()!.n).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM mileage_ledger').get()!.n).toBe(0);
      expect(db.prepare("SELECT status FROM mileage_programs WHERE id = 'default'").get()!.status).toBe('paused');
      expect(db.prepare("SELECT is_active FROM auto_replies WHERE id = 'builtin-mileage-wallet-keyword'").get()!.is_active).toBe(0);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
});
