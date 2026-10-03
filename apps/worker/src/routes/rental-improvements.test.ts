import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createRentalQuoteRequest, type RentalEstimate } from '@line-crm/db';
import { rentalPricing } from '@line-crm/shared';
import { estimatePriceValues, validateQuoteRequestBody } from '../services/rental.js';
import { publishRentalQuotes } from '../services/rental-publication.js';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: vi.fn(async (header) => header === 'Bearer customer' ? 'line-a' : null) }));
import { rental } from './rental.js';
import { hasRentalApplicationRequested } from './webhook.js';

describe('rental upgrade with transactional SQLite and mocked LINE only', () => {
  let sqlite: import('node:sqlite').DatabaseSync, db: D1Database, requestId: string, estimateId: string, app: Hono;
  let pushes: any[];
  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    db = { prepare(sql: string) { const statement = sqlite.prepare(sql); let args: any[] = []; return {
      bind(...values: any[]) { args = values; return this; }, async all() { return { results: statement.all(...args), success: true }; },
      async first() { return statement.get(...args) ?? null; }, async run() { const result = statement.run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    }; }, async batch(statements: any[]) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } } as unknown as D1Database;
    sqlite.exec("INSERT INTO friends(id,line_user_id,created_at,updated_at) VALUES ('friend-a','line-a','2026-10-01','2026-10-01'), ('friend-b','line-b','2026-10-01','2026-10-01')");
    const created = await createRentalQuoteRequest(db, { friendId: 'friend-a', propertyName: 'テスト物件', roomNumbers: ['101', '102'], nickname: 'test', desiredMoveInDate: '未定', hasPets: false, needsParking: false, hasMotorbike: false, needsBicycleParking: false });
    requestId = created.requestId; estimateId = created.estimates[0].id;
    sqlite.prepare('UPDATE rental_estimates SET rent = 80000, management_fee = 5000, monthly_other_cost = 0, brokerage_fee = 88000, brokerage_discount = 20000, cashback = 5000, advance_rent = 85000, manager_memo = ?').run('private memo');
    pushes = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => { if (String(url).includes('quota/consumption')) return Response.json({ totalUsage: 0 }); if (String(url).includes('quota')) return Response.json({ type: 'none' }); pushes.push({ url, options }); return Response.json({}); }));
    app = new Hono(); app.use('/api/rental/*', async (c, next) => { (c as any).set('staff', { id: 'owner', name: 'Owner', role: 'owner' }); await next(); }); app.route('/', rental);
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });
  const env = () => ({ DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'fake-test-only', LIFF_URL: 'https://liff.line.me/test' });
  const snapshot = (row: RentalEstimate) => ({ id: row.id, revision: row.revision, pricingVersion: row.pricing_version, ...rentalPricing(estimatePriceValues(row)), rent: row.rent, customerNotes: row.customer_notes, paymentTotal: row.payment_total });
  const publish = (revisions = [{ id: estimateId, revision: 0 }]) => publishRentalQuotes({ env: env() }, { requestId, revisions, snapshot, listUrl: async () => 'https://liff.line.me/test/rental/requests/test' });
  test('publishes immutable values: a later draft edit cannot change customer totals', async () => {
    await publish(); sqlite.prepare('UPDATE rental_estimates SET brokerage_fee = 999999, revision = 1, manager_memo = ? WHERE id = ?').run('changed private memo', estimateId);
    const body: any = await (await app.request('/api/liff/rental/requests/' + requestId + '/estimates', { headers: { Authorization: 'Bearer customer' } }, env())).json();
    expect(body.data.estimates[0].upfrontSubtotal).toBe(153000); expect(body.data.estimates[0].upfrontTotal).toBeNull();
    expect(JSON.stringify(body)).not.toContain('private memo'); expect(body.data.estimates[0].revision).toBe(0);
  });
  test('stale save and send revisions are rejected, with no LINE push', async () => {
    sqlite.prepare('UPDATE rental_estimates SET revision = 1 WHERE id = ?').run(estimateId);
    expect((await app.request('/api/rental/estimates/' + estimateId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rent: 90000, expectedRevision: 0 }) }, env())).status).toBe(409);
    await expect(publish()).rejects.toThrow('別の編集'); expect(pushes).toHaveLength(0);
  });
  test('failed LINE notification retries with the same key and creates one publication', async () => {
    let failed = false;
    (fetch as any).mockImplementation(async (url: any, options: any) => {
      if (String(url).includes('quota/consumption')) return Response.json({ totalUsage: 0 });
      if (String(url).includes('quota')) return Response.json({ type: 'none' });
      pushes.push({ url, options });
      if (!failed) { failed = true; return new Response('timeout', { status: 503 }); }
      return Response.json({});
    });
    expect(await publish()).toMatchObject({ published: true, notificationSent: false });
    await publish(); const keys = pushes.map((p) => p.options.headers['X-Line-Retry-Key']);
    // First failed request was handled by the one-off mock, while retry is captured.
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(keys[0]).toBe(sqlite.prepare('SELECT id FROM rental_quote_deliveries').get()!.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_estimate_versions').get()!.n).toBe(1);
    expect(sqlite.prepare('SELECT status FROM rental_quote_deliveries').get()!.status).toBe('sent');
    const again = await publish(); expect(again.alreadySent).toBe(true); expect(pushes).toHaveLength(2);
  });
  test('publishes multiple rooms with one push and one persisted retry key', async () => {
    const rows = sqlite.prepare('SELECT id, revision FROM rental_estimates').all() as any[]; await publish(rows as any);
    expect(pushes).toHaveLength(1); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_estimate_versions').get()!.n).toBe(2);
  });
  test('submission key deduplicates repeat submits per customer and rolls back new rooms', async () => {
    const input = { friendId: 'friend-a', propertyName: '新しい物件', roomNumbers: ['301'], nickname: 'test', desiredMoveInDate: '未定', hasPets: false, needsParking: false, hasMotorbike: false, needsBicycleParking: false, submissionKey: '11111111-1111-1111-1111-111111111111' };
    const first = await createRentalQuoteRequest(db, input), second = await createRentalQuoteRequest(db, input);
    expect(second.requestId).toBe(first.requestId); expect(second.duplicate).toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_estimates WHERE request_id = ?').get(first.requestId)!.n).toBe(1);
    await expect(createRentalQuoteRequest(db, { ...input, nickname: 'edited' })).rejects.toThrow('rental_submission_conflict');
    const other = await createRentalQuoteRequest(db, { ...input, friendId: 'friend-b' }); expect(other.requestId).not.toBe(first.requestId);
  });
  test('pending request list exposes no drafts or other customer data', async () => {
    const body: any = await (await app.request('/api/liff/rental/requests', { headers: { Authorization: 'Bearer customer' } }, env())).json();
    expect(body.data[0]).toMatchObject({ roomCount: 2, presentedCount: 0 }); expect(JSON.stringify(body)).not.toContain('80000'); expect(JSON.stringify(body)).not.toContain('private memo');
    expect((await app.request('/api/liff/rental/estimates/' + estimateId + '/versions', { headers: { Authorization: 'Bearer customer' } }, env())).status).toBe(404);
  });
  test('application intent retains its quoted version and permanently enables individual support', async () => {
    const sent = await app.request('/api/rental/estimates/' + estimateId + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0 }) }, env());
    expect(sent.status).toBe(200);
    const request = () => app.request('/api/liff/rental/estimates/' + estimateId + '/application-request', { method: 'POST', headers: { Authorization: 'Bearer customer', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0 }) }, env());
    expect((await request()).status).toBe(200); expect((await request()).status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_application_requests').get()!.n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM messages_log WHERE source = 'rental_application_requested'").get()!.n).toBe(1);
    sqlite.prepare("UPDATE rental_estimates SET status = 'cancelled', rent = 999999, revision = 1 WHERE id = ?").run(estimateId);
    expect(await hasRentalApplicationRequested(db, 'friend-a')).toBe(true);
    expect(await hasRentalApplicationRequested(db, 'friend-b')).toBe(false);
    const accepted: any = sqlite.prepare('SELECT snapshot FROM rental_application_requests').get();
    expect(JSON.parse(accepted.snapshot).rent).toBe(80000); expect(accepted.snapshot).not.toContain('private memo');
  });
  test('unknown differs from confirmed free and later cashback does not reduce initial payment', () => {
    const costs: any = { rent: 80000, managementFee: 5000, monthlyOtherCost: 0, deposit: 0, keyMoney: 0, advanceRent: 85000, proratedRent: 0, fireInsurance: 20000, guaranteeCompanyFee: 42500, keyExchangeFee: 0, cleaningFee: 0, otherInitialCost: 0, brokerageFee: 88000, brokerageDiscount: 20000, cashback: 5000 };
    expect(rentalPricing(costs)).toMatchObject({ monthlyTotal: 85000, upfrontTotal: 215500, effectiveTotal: 210500 });
    expect(rentalPricing({ ...costs, fireInsurance: null })).toMatchObject({ upfrontTotal: null, upfrontSubtotal: 195500, effectiveTotal: null, unknownInitialFields: ['fireInsurance'] });
  });
  test('accepts NFKC rooms, unknown date/month, rejects invalid dates and ambiguous property names', () => {
    const input = { propertyName: '物件', propertyAddress: '大阪市北区', roomNumbers: ['１０１号室', '101', '202'], desiredMoveInDate: '2026-11頃', nickname: 'test', hasPets: false, needsParking: false, hasMotorbike: false, needsBicycleParking: false };
    const result = validateQuoteRequestBody(input); expect(result.ok).toBe(true); if (result.ok) expect(result.value.roomNumbers).toEqual(['101', '202']);
    expect(validateQuoteRequestBody({ ...input, desiredMoveInDate: '未定' }).ok).toBe(true);
    expect(validateQuoteRequestBody({ ...input, desiredMoveInDate: '2026-02-30' }).ok).toBe(false);
    expect(validateQuoteRequestBody({ ...input, desiredMoveInDate: '2026-99頃' }).ok).toBe(false);
    expect(validateQuoteRequestBody({ ...input, propertyAddress: '' }).ok).toBe(false);
  });
});
