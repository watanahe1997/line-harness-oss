import { LineClient } from '@line-crm/line-sdk';
import { getFriendById, getLineAccountById, jstNow, type RentalEstimate } from '@line-crm/db';
import { getLinePlanQuotaShortfall } from './quota-alert.js';

/** Publish one immutable version per room and send one notification per request.
 * LINE's retry key is persisted before contacting LINE, so a timeout can be retried.
 * Saving and uploading share the revision/lock guard with this publisher.
 */
export async function publishRentalQuotes(c: any, input: {
  requestId: string; revisions: Array<{ id: string; revision: number }>;
  snapshot: (row: RentalEstimate) => Record<string, unknown>;
  listUrl: (friend: any) => Promise<string>;
}) {
  const db = c.env.DB as D1Database;
  const request = await db.prepare('SELECT * FROM rental_quote_requests WHERE id = ? AND deleted_at IS NULL')
    .bind(input.requestId).first<{ friend_id: string; property_name: string }>();
  if (!request) throw new Error('見積依頼が見つかりません');
  const friend = await getFriendById(db, request.friend_id);
  if (!friend) throw new Error('LINE友だちが見つかりません');
  const revisions = JSON.stringify([...input.revisions].sort((a, b) => a.id.localeCompare(b.id)));
  let job = await db.prepare('SELECT * FROM rental_quote_deliveries WHERE request_id = ? AND revisions = ?')
    .bind(input.requestId, revisions).first<{ id: string; message: string; status: string; created_at: string; sent_at: string }>();
  if (job?.status === 'sent') return { sentAt: job.sent_at, notificationSent: true, alreadySent: true };
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (friend.line_account_id) {
    const account = await getLineAccountById(db, friend.line_account_id);
    if (account) accessToken = account.channel_access_token;
  }
  const client = new LineClient(accessToken);
  if (await getLinePlanQuotaShortfall(client, 1)) throw new Error('LINEの月間配信上限に達しています。プランをご確認ください');
  if (!job) {
    const rows = (await db.prepare('SELECT * FROM rental_estimates WHERE request_id = ? AND deleted_at IS NULL ORDER BY sort_order')
      .bind(input.requestId).all<RentalEstimate>()).results.filter((row) => input.revisions.some((r) => r.id === row.id));
    if (!rows.length || rows.length !== input.revisions.length) throw new Error('送信対象を確認してください');
    for (const row of rows) {
      if (row.revision !== input.revisions.find((r) => r.id === row.id)?.revision) throw new Error('別の編集が保存されています。再読み込みしてください');
      if (['out_of_scope', 'cancelled'].includes(row.status)) throw new Error('対象外・キャンセルの見積は送信できません');
      const snap = input.snapshot(row);
      if (row.rent == null || !['deposit', 'key_money', 'advance_rent', 'prorated_rent', 'fire_insurance', 'guarantee_company_fee', 'key_exchange_fee', 'cleaning_fee', 'other_initial_cost', 'brokerage_fee'].some((key) => (row as any)[key] != null)) throw new Error('月額家賃と初期費用を入力してください');
      if (snap.invalidDiscount || snap.invalidCashback) throw new Error('割引・キャッシュバックが対象の費用を超えています');
    }
    const id = crypto.randomUUID(), now = jstNow();
    const claims = await db.batch(rows.map((row) => db.prepare(`UPDATE rental_estimates SET send_lock = ?, send_lock_at = ?
      WHERE id = ? AND revision = ? AND (send_lock IS NULL OR datetime(send_lock_at) < datetime('now', '+9 hours', '-5 minutes'))`)
      .bind(id, now, row.id, row.revision)));
    if (claims.some((result) => result.meta.changes !== 1)) {
      await db.prepare('UPDATE rental_estimates SET send_lock = NULL, send_lock_at = NULL WHERE send_lock = ?').bind(id).run();
      throw new Error('別の送信・編集が進行中です。再読み込みして確認してください');
    }
    try {
      const listUrl = await input.listUrl(friend);
      const summary = rows.map((row) => {
        const snap = input.snapshot(row);
        return `${row.room_number}：${snap.pricingVersion === 1 ? snap.upfrontTotal == null ? '確認済み費用の小計' : '初期支払額' : '旧形式の総額'} ${Number(snap.pricingVersion === 1 ? snap.upfrontSubtotal : snap.paymentTotal ?? 0).toLocaleString('ja-JP')}円`;
      }).join('\n');
      const message = { type: 'flex', altText: `${request.property_name}の概算見積（${rows.length}件）をご案内します`.slice(0, 400), contents: {
        type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: request.property_name.slice(0, 300), weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: summary, wrap: true, size: 'sm' },
          { type: 'text', text: '概算の内訳・確認中の費用・図面を確認できます。キャッシュバックは初期費用の入金確認後に受け取ります。', wrap: true, size: 'xs', color: '#555555' },
          { type: 'text', text: '希望する部屋から「この部屋で審査申込を希望する」を選んでください。正式な費用・空室状況は確認が必要です。', wrap: true, size: 'xs', color: '#555555' },
        ] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: '見積・図面を確認', uri: listUrl } }] },
      } };
      const statements = rows.flatMap((row) => {
        const snapshot = JSON.stringify({ ...input.snapshot(row), sentAt: now });
        return [db.prepare(`INSERT OR IGNORE INTO rental_estimate_versions(estimate_id, revision, snapshot, floor_plan_key, published_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(row.id, row.revision, snapshot, row.floor_plan_key, now),
        db.prepare(`UPDATE rental_estimates SET published_snapshot = ?, published_floor_plan_key = ?, sent_at = ?,
          status = CASE WHEN status IN ('quote_pending', 'quote_in_progress') THEN 'quote_presented' ELSE status END,
          send_lock = NULL, send_lock_at = NULL WHERE id = ? AND send_lock = ?`).bind(snapshot, row.floor_plan_key, now, row.id, id)];
      });
      statements.push(db.prepare('INSERT INTO rental_quote_deliveries(id, request_id, revisions, message, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, input.requestId, revisions, JSON.stringify(message), now));
      await db.batch(statements);
      job = { id, message: JSON.stringify(message), created_at: now, status: 'pending', sent_at: '' };
    } catch (error) {
      await db.prepare('UPDATE rental_estimates SET send_lock = NULL, send_lock_at = NULL WHERE send_lock = ?').bind(id).run();
      throw error;
    }
  }
  if (Date.now() - new Date(job.created_at).getTime() > 23 * 60 * 60_000) {
    throw new Error('通知の再試行期限が過ぎています。LINEの送信履歴を確認してください');
  }
  try {
    await client.pushMessage(friend.line_user_id, [JSON.parse(job.message)], job.id);
  } catch (error) {
    // The quote remains published. Retrying the same revision uses the same LINE key.
    await db.prepare("UPDATE rental_quote_deliveries SET status = 'failed', last_error = 'LINE通知に失敗' WHERE id = ? AND status != 'sent'").bind(job.id).run();
    return { notificationSent: false, published: true };
  }
  const sentAt = jstNow();
  await db.batch([
    db.prepare("UPDATE rental_quote_deliveries SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").bind(sentAt, job.id),
    db.prepare(`INSERT OR IGNORE INTO messages_log(id, friend_id, direction, message_type, content, source, line_account_id, created_at)
      VALUES (?, ?, 'outgoing', 'flex', ?, 'rental_quote_ready', ?, ?)`).bind(job.id, friend.id, job.message, friend.line_account_id ?? null, sentAt),
  ]);
  return { sentAt, notificationSent: true };
}
