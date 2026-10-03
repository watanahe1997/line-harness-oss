import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRentalQuoteRequest } from '@line-crm/db';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineUserId: vi.fn(async (header: string | undefined) =>
    header === 'Bearer customer-a' ? 'line-a' : header === 'Bearer customer-b' ? 'line-b' : null),
}));

import { rental } from './rental.js';

describe('customer quote history (real SQLite, no production LINE/D1)', () => {
  let sqlite: import('node:sqlite').DatabaseSync;
  let db: D1Database;
  let app: Hono;
  let firstRequest: string;

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    db = {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        let args: any[] = [];
        return {
          bind(...values: any[]) { args = values; return this; },
          async all() { return { results: statement.all(...args), success: true }; },
          async first() { return statement.get(...args) ?? null; },
          async run() { return { ...statement.run(...args), success: true }; },
        };
      },
      async batch(statements: any[]) { return Promise.all(statements.map((statement) => statement.run())); },
    } as unknown as D1Database;
    sqlite.exec(`INSERT INTO friends (id, line_user_id, created_at, updated_at)
      VALUES ('friend-a', 'line-a', '2026-09-01', '2026-09-01'), ('friend-b', 'line-b', '2026-09-01', '2026-09-01')`);
    for (const [friendId, propertyName, rooms] of [
      ['friend-a', '以前の物件', ['101', '102', '103']],
      ['friend-a', '新しい物件', ['201']],
      ['friend-b', '別のお客様の物件', ['301']],
      ['friend-a', '削除した依頼', ['401']],
    ] as Array<[string, string, string[]]>) {
      const created = await createRentalQuoteRequest(db, {
        friendId, propertyName, roomNumbers: rooms, nickname: 'test', desiredMoveInDate: '2026-11-01',
        hasPets: false, needsParking: false, hasMotorbike: false, needsBicycleParking: false,
      });
      if (propertyName === '以前の物件') firstRequest = created.requestId;
      for (const estimate of created.estimates) {
        const sentAt = estimate.roomNumber === '102' ? null : estimate.roomNumber === '201' ? '2026-09-30 10:00:00' : '2026-09-20 10:00:00';
        sqlite.prepare(`UPDATE rental_estimates SET sent_at = ?, status = ?, payment_total = 123456,
          manager_memo = 'internal-only', floor_plan_key = 'private/r2-key' WHERE id = ?`)
          .run(sentAt, estimate.roomNumber === '101' ? 'contracted' : 'quote_presented', estimate.id);
        if (estimate.roomNumber === '103') sqlite.prepare('UPDATE rental_estimates SET deleted_at = ? WHERE id = ?').run('2026-09-29', estimate.id);
      }
      if (propertyName === '削除した依頼') sqlite.prepare('UPDATE rental_quote_requests SET deleted_at = ? WHERE id = ?').run('2026-09-29', created.requestId);
    }
    app = new Hono();
    app.route('/', rental);
  });

  afterEach(() => sqlite.close());

  async function history(token = 'customer-a') {
    return app.request('/api/liff/rental/estimates', { headers: { Authorization: `Bearer ${token}` } }, { DB: db });
  }

  test('returns every sent quote across requests, including contracted history, newest first', async () => {
    const response = await history();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body: any = await response.json();
    expect(body.data.estimateCount).toBe(2);
    expect(body.data.requests.map((request: any) => request.propertyName)).toEqual(['新しい物件', '以前の物件']);
    expect(body.data.requests.flatMap((request: any) => request.estimates.map((estimate: any) => estimate.roomNumber))).toEqual(['201', '101']);
    expect(body.data.requests[1].estimates[0].status).toBe('contracted');
    expect(JSON.stringify(body)).not.toContain('internal-only');
    expect(JSON.stringify(body)).not.toContain('private/r2-key');
  });

  test('separates customer B from customer A', async () => {
    const body: any = await (await history('customer-b')).json();
    expect(body.data.estimateCount).toBe(1);
    expect(body.data.requests[0].propertyName).toBe('別のお客様の物件');
  });

  test('rejects missing or invalid LINE identity', async () => {
    expect((await history('invalid')).status).toBe(401);
    expect((await app.request('/api/liff/rental/estimates', {}, { DB: db })).status).toBe(401);
  });

  test('returns an empty history for a customer without sent quotes', async () => {
    sqlite.exec("UPDATE rental_estimates SET sent_at = NULL");
    const body: any = await (await history()).json();
    expect(body.data).toEqual({ requests: [], estimateCount: 0 });
  });

  test('opening request details still excludes unfinished and deleted quotes', async () => {
    const response = await app.request(`/api/liff/rental/requests/${firstRequest}/estimates`,
      { headers: { Authorization: 'Bearer customer-a' } }, { DB: db });
    const body: any = await response.json();
    expect(body.data.estimates.map((estimate: any) => estimate.roomNumber)).toEqual(['101']);
    expect((await app.request(`/api/liff/rental/requests/${firstRequest}/estimates`,
      { headers: { Authorization: 'Bearer customer-b' } }, { DB: db })).status).toBe(404);
  });
});
