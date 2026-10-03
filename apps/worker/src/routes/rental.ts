import { Hono } from 'hono';
import { rentalPricing, RENTAL_CASHBACK_NOTE } from '@line-crm/shared';
import { publishRentalQuotes } from '../services/rental-publication.js';
import { LineClient } from '@line-crm/line-sdk';
import {
  addTagToFriend,
  createRentalQuoteRequest,
  createTag,
  getFriendById,
  getFriendByLineUserId,
  getLineAccountById,
  getRentalEstimateOwnedByLineUser,
  getRentalRequestOwnedByLineUser,
  listRentalPresentedEstimatesOwnedByLineUser,
  getTags,
  jstNow,
  removeTagFromFriend,
  upsertChatOnMessage,
  writeRentalAuditLog,
  type Friend,
  type RentalApplicationStatus,
  type RentalEstimate,
  type RentalStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import {
  ESTIMATE_MONEY_FIELDS,
  RENTAL_APPLICATION_STATUS_LABELS,
  RENTAL_SAFE_LINE_MESSAGES,
  RENTAL_STATUS_LABELS,
  applicationRequestReceiptMessage,
  applicationReceiptMessage,
  calculatePaymentTotal,
  estimatePriceValues,
  csvCell,
  decodeRentalFile,
  isRentalApplicationStatus,
  isRentalStatus,
  nonNegativeInteger,
  normalizeOptionalText,
  quoteReadyMessage,
  quoteReceiptMessage,
  validateQuoteRequestBody,
} from '../services/rental.js';

const rental = new Hono<Env>();

type RentalSettings = {
  privacy_policy_url: string | null;
  identity_upload_enabled: number;
  data_retention_days: number;
  rich_menu_group_map: string;
  updated_at: string;
};

type RentalApplication = Record<string, unknown> & {
  id: string;
  request_id: string;
  estimate_id: string;
  friend_id: string;
  status: RentalApplicationStatus;
  identity_file_key: string | null;
  identity_file_name: string | null;
  identity_file_mime: string | null;
  identity_file_size: number | null;
  created_at: string;
  updated_at: string;
  anonymized_at: string | null;
  deleted_at: string | null;
};

const REQUEST_STATUS_TAGS = Object.values(RENTAL_STATUS_LABELS);
const APPLICATION_STATUS_TAGS = Object.values(RENTAL_APPLICATION_STATUS_LABELS);
const ALL_RENTAL_TAGS = [...new Set(['概算見積依頼済み', ...REQUEST_STATUS_TAGS, ...APPLICATION_STATUS_TAGS])];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function liffIdentity(c: any): Promise<{
  lineUserId: string;
  friend: Friend;
} | Response> {
  const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!lineUserId) return c.json({ success: false, error: 'LINE本人確認に失敗しました' }, 401);
  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
  if (!friend) return c.json({ success: false, error: 'LINE友だち情報が見つかりません' }, 404);
  return { lineUserId, friend };
}

async function getSettings(db: D1Database): Promise<RentalSettings> {
  const row = await db.prepare(
    `SELECT privacy_policy_url, identity_upload_enabled, data_retention_days, rich_menu_group_map, updated_at
     FROM rental_settings WHERE id = 'default'`,
  ).first<RentalSettings>();
  return row ?? {
    privacy_policy_url: null,
    identity_upload_enabled: 0,
    data_retention_days: 365,
    rich_menu_group_map: '{}',
    updated_at: jstNow(),
  };
}

async function sendLineText(c: any, friend: Friend, text: string, source: string): Promise<void> {
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (friend.line_account_id) {
    const account = await getLineAccountById(c.env.DB, friend.line_account_id);
    if (account) accessToken = account.channel_access_token;
  }
  const client = new LineClient(accessToken);
  await client.pushMessage(friend.line_user_id, [{ type: 'text', text }]);
  await c.env.DB.prepare(
    `INSERT INTO messages_log (
       id, friend_id, direction, message_type, content, source, line_account_id, created_at
     ) VALUES (?, ?, 'outgoing', 'text', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), friend.id, text, source, friend.line_account_id, jstNow()).run();
}

async function setRentalStatusTag(c: any, friendId: string, label: string): Promise<void> {
  const db = c.env.DB as D1Database;
  const tags = await getTags(db);
  const rentalTags = tags.filter((tag) => ALL_RENTAL_TAGS.includes(tag.name));
  for (const tag of rentalTags) await removeTagFromFriend(db, friendId, tag.id);
  let target = tags.find((tag) => tag.name === label);
  if (!target) {
    try {
      target = await createTag(db, { name: label, color: '#06C755' });
    } catch {
      target = (await getTags(db)).find((tag) => tag.name === label);
    }
  }
  if (target) await addTagToFriend(db, friendId, target.id);

  // Optional automatic rich-menu switch. The Owner maps the three rental
  // phases to existing *published* rich-menu groups in rental_settings.
  // A switch failure must never roll back the business state/tag update.
  try {
    const settings = await getSettings(db);
    const map = JSON.parse(settings.rich_menu_group_map || '{}') as Record<string, string>;
    const phase = label === '見積提示済み'
      ? 'quotePresented'
      : APPLICATION_STATUS_TAGS.includes(label) || ['審査申込希望', '審査申込入力済み', '個別対応中', '成約'].includes(label)
        ? 'application'
        : 'initial';
    const groupId = map[phase];
    if (!groupId) return;
    const friend = await getFriendById(db, friendId);
    if (!friend) return;
    const menu = await db.prepare(
      `SELECT g.account_id, p.line_richmenu_id
       FROM rich_menu_groups g
       JOIN rich_menu_pages p ON p.group_id = g.id
       WHERE g.id = ? AND g.status = 'published' AND p.line_richmenu_id IS NOT NULL
       ORDER BY CASE WHEN p.id = g.default_page_id THEN 0 ELSE 1 END, p.order_index
       LIMIT 1`,
    ).bind(groupId).first<{ account_id: string; line_richmenu_id: string }>();
    if (!menu || (friend.line_account_id && friend.line_account_id !== menu.account_id)) return;
    const account = await getLineAccountById(db, menu.account_id);
    if (!account) return;
    await new LineClient(account.channel_access_token).linkRichMenuToUser(friend.line_user_id, menu.line_richmenu_id);
  } catch (error) {
    console.error('rental rich-menu switch failed:', errorMessage(error));
  }
}

function serializeEstimate(row: RentalEstimate, includeInternal = false) {
  const price = rentalPricing(estimatePriceValues(row));
  const value: Record<string, unknown> = {
    id: row.id,
    requestId: row.request_id,
    roomNumber: row.room_number,
    sortOrder: row.sort_order,
    status: row.status,
    statusLabel: RENTAL_STATUS_LABELS[row.status],
    rent: row.rent,
    managementFee: row.management_fee,
    monthlyOtherCost: row.monthly_other_cost,
    pricingVersion: row.pricing_version, revision: row.revision,
    ...price, cashbackNote: RENTAL_CASHBACK_NOTE,
    deposit: row.deposit,
    keyMoney: row.key_money,
    advanceRent: row.advance_rent,
    proratedRent: row.prorated_rent,
    fireInsurance: row.fire_insurance,
    guaranteeCompanyFee: row.guarantee_company_fee,
    keyExchangeFee: row.key_exchange_fee,
    cleaningFee: row.cleaning_fee,
    otherInitialCost: row.other_initial_cost,
    brokerageFee: row.brokerage_fee,
    brokerageDiscount: row.brokerage_discount,
    cashback: row.cashback,
    paymentTotal: row.payment_total,
    customerNotes: row.customer_notes,
    hasFloorPlan: Boolean(row.floor_plan_key),
    floorPlanName: row.floor_plan_name,
    floorPlanMime: row.floor_plan_mime,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!includeInternal && row.published_snapshot) {
    return { ...JSON.parse(row.published_snapshot), status: row.status, statusLabel: RENTAL_STATUS_LABELS[row.status] };
  }
  if (includeInternal) {
    value.managerMemo = row.manager_memo;
    value.publishedRevision = row.published_snapshot ? JSON.parse(row.published_snapshot).revision : null;
  }
  return value;
}

async function syncRequestStatus(db: D1Database, requestId: string): Promise<RentalStatus> {
  const rows = await db.prepare(
    `SELECT status FROM rental_estimates
     WHERE request_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
  ).bind(requestId).all<{ status: RentalStatus }>();
  const statuses = rows.results.map((row) => row.status);
  const priority: RentalStatus[] = [
    'contracted', 'application_submitted', 'application_requested',
    'individual_followup', 'quote_presented', 'quote_in_progress', 'quote_pending',
  ];
  let status = priority.find((candidate) => statuses.includes(candidate));
  if (!status) status = statuses.length > 0 && statuses.every((value) => value === 'out_of_scope')
    ? 'out_of_scope'
    : 'cancelled';
  await db.prepare(
    `UPDATE rental_quote_requests SET status = ?, updated_at = ? WHERE id = ?`,
  ).bind(status, jstNow(), requestId).run();
  return status;
}

async function liffDeepLink(c: any, path: string, friend: Friend): Promise<string> {
  let base = c.env.LIFF_URL.replace(/\/+$/, '');
  let liffId = base.match(/liff\.line\.me\/([^/?]+)/)?.[1] ?? null;
  if (friend.line_account_id) {
    const account = await getLineAccountById(c.env.DB, friend.line_account_id);
    if (account?.liff_id) {
      liffId = account.liff_id;
      base = `https://liff.line.me/${account.liff_id}`;
    }
  }
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (liffId) url.searchParams.set('liffId', liffId);
  return url.toString();
}

// ---------------------------------------------------------------------------
// LIFF/customer routes. authMiddleware intentionally skips /api/liff/*, so
// every handler verifies the LINE Login id_token and checks ownership.
// ---------------------------------------------------------------------------

rental.get('/api/liff/rental/settings', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const settings = await getSettings(c.env.DB);
  return c.json({
    success: true,
    data: {
      privacyPolicyUrl: settings.privacy_policy_url,
      identityUploadEnabled: Boolean(settings.identity_upload_enabled),
    },
  });
});

rental.post('/api/liff/rental/quote-requests', async (c) => {
  try {
    const identity = await liffIdentity(c);
    if (identity instanceof Response) return identity;
    const body = await c.req.json().catch(() => ({}));
    const validated = validateQuoteRequestBody(body);
    if (!validated.ok) return c.json({ success: false, error: validated.error }, 400);

    const created = await createRentalQuoteRequest(c.env.DB, {
      friendId: identity.friend.id,
      ...validated.value,
    });
    if (!created.duplicate) await writeRentalAuditLog(c.env.DB, {
      actorType: 'line_user',
      actorId: identity.lineUserId,
      action: 'create',
      entityType: 'quote_request',
      entityId: created.requestId,
      metadata: { estimateCount: created.estimates.length },
    });
    if (!created.duplicate) await setRentalStatusTag(c, identity.friend.id, '概算見積依頼済み').catch(() => console.error('rental tag update failed'));
    if (created.duplicate) return c.json({ success: true, data: { ...created, notificationSent: false } });
    let notificationSent = true;
    try {
      await sendLineText(c, identity.friend, quoteReceiptMessage(validated.value.propertyName, validated.value.roomNumbers), 'rental_quote_receipt');
      await c.env.DB.prepare('UPDATE rental_quote_requests SET receipt_sent_at = ? WHERE id = ?').bind(jstNow(), created.requestId).run();
    } catch (error) {
      notificationSent = false;
      console.error('rental quote receipt push failed:', errorMessage(error));
    }
    return c.json({ success: true, data: { ...created, notificationSent } }, 201);
  } catch (error) {
    if (errorMessage(error) === 'rental_submission_conflict') return c.json({ success: false, error: '以前の内容で依頼を受付済みです。依頼状況をご確認ください。別の依頼は入力内容をクリアしてから作成してください。' }, 409);
    console.error('POST rental quote request:', error);
    return c.json({ success: false, error: '概算見積依頼を保存できませんでした' }, 500);
  }
});

rental.get('/api/liff/rental/estimates', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const rows = await listRentalPresentedEstimatesOwnedByLineUser(c.env.DB, identity.lineUserId);
  const requests = new Map<string, {
    id: string; propertyName: string; propertyUrl: string | null; createdAt: string;
    estimates: ReturnType<typeof serializeEstimate>[];
  }>();
  for (const row of rows) {
    let request = requests.get(row.request_id);
    if (!request) {
      request = {
        id: row.request_id, propertyName: row.property_name,
        propertyUrl: row.property_url, createdAt: row.request_created_at, estimates: [],
      };
      requests.set(row.request_id, request);
    }
    request.estimates.push(serializeEstimate(row));
  }
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'line_user', actorId: identity.lineUserId, action: 'view',
    entityType: 'quote_history', entityId: identity.friend.id,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: { requests: [...requests.values()], estimateCount: rows.length } });
});

rental.get('/api/liff/rental/requests', async (c) => {
  const identity = await liffIdentity(c); if (identity instanceof Response) return identity;
  const rows = await c.env.DB.prepare(`SELECT r.id, r.property_name, r.created_at, r.status,
    COUNT(e.id) AS rooms, SUM(CASE WHEN e.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS presented
    FROM rental_quote_requests r LEFT JOIN rental_estimates e ON e.request_id = r.id AND e.deleted_at IS NULL
    WHERE r.friend_id = ? AND r.deleted_at IS NULL GROUP BY r.id ORDER BY r.created_at DESC`)
    .bind(identity.friend.id).all<{ id: string; property_name: string; created_at: string; status: RentalStatus; rooms: number; presented: number }>();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: rows.results.map((row) => ({ id: row.id, propertyName: row.property_name,
    createdAt: row.created_at, status: row.status, statusLabel: RENTAL_STATUS_LABELS[row.status], roomCount: row.rooms, presentedCount: row.presented })) });
});
rental.get('/api/liff/rental/estimates/:id/versions', async (c) => {
  const identity = await liffIdentity(c); if (identity instanceof Response) return identity;
  const owned = await getRentalEstimateOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
  if (!owned?.sent_at) return c.json({ success: false, error: '見積が見つかりません' }, 404);
  const versions = await c.env.DB.prepare('SELECT snapshot FROM rental_estimate_versions WHERE estimate_id = ? ORDER BY revision DESC')
    .bind(owned.id).all<{ snapshot: string }>();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: versions.results.map((row) => JSON.parse(row.snapshot)) });
});
rental.get('/api/liff/rental/requests/:id/estimates', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const request = await getRentalRequestOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
  if (!request) return c.json({ success: false, error: '見積依頼が見つかりません' }, 404);
  const estimates = await c.env.DB.prepare(
    `SELECT * FROM rental_estimates WHERE request_id = ? AND sent_at IS NOT NULL AND deleted_at IS NULL ORDER BY sort_order`,
  ).bind(request.id).all<RentalEstimate>();
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'line_user', actorId: identity.lineUserId, action: 'view',
    entityType: 'quote_request', entityId: request.id,
  });
  return c.json({
    success: true,
    data: {
      request: {
        id: request.id,
        propertyName: request.property_name,
        propertyUrl: request.property_url,
        status: request.status,
        createdAt: request.created_at,
      },
      estimates: estimates.results.map((row) => serializeEstimate(row)),
    },
  });
});

rental.get('/api/liff/rental/estimates/:id/floor-plan', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const estimate = await getRentalEstimateOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
  if (!estimate?.sent_at) return c.json({ success: false, error: '図面が見つかりません' }, 404);
  let fileKey = estimate.published_floor_plan_key;
  let shown = estimate.published_snapshot ? JSON.parse(estimate.published_snapshot) : null;
  const revision = c.req.query('revision');
  if (revision) {
    const version = await c.env.DB.prepare('SELECT floor_plan_key, snapshot FROM rental_estimate_versions WHERE estimate_id = ? AND revision = ?')
      .bind(estimate.id, Number(revision)).first<{ floor_plan_key: string | null; snapshot: string }>();
    if (!version) return c.json({ success: false, error: '図面が見つかりません' }, 404);
    fileKey = version.floor_plan_key; shown = JSON.parse(version.snapshot);
  }
  if (!fileKey) return c.json({ success: false, error: '図面が見つかりません' }, 404);
  const object = await c.env.IMAGES.get(fileKey);
  if (!object) return c.json({ success: false, error: '図面が見つかりません' }, 404);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'line_user', actorId: identity.lineUserId, action: 'view_file',
    entityType: 'estimate', entityId: estimate.id,
  });
  const headers = new Headers({
    'Content-Type': shown?.floorPlanMime || estimate.floor_plan_mime || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(shown?.floorPlanName || 'floor-plan')}`,
    'X-Content-Type-Options': 'nosniff',
  });
  return new Response(object.body, { headers });
});

rental.get('/api/liff/rental/estimates/:id/application-preview', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const estimate = await getRentalEstimateOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
  if (!estimate?.sent_at) return c.json({ success: false, error: '申込対象が見つかりません' }, 404);
  if (!['quote_presented', 'application_requested', 'application_submitted'].includes(estimate.status)) {
    return c.json({ success: false, error: 'この見積は審査申込できません' }, 409);
  }
  const existing = await c.env.DB.prepare(
    `SELECT id, status FROM rental_applications WHERE estimate_id = ? AND deleted_at IS NULL`,
  ).bind(estimate.id).first<{ id: string; status: RentalApplicationStatus }>();
  return c.json({
    success: true,
    data: {
      estimateId: estimate.id,
      requestId: estimate.request_id,
      propertyName: estimate.property_name,
      propertyUrl: estimate.property_url,
      roomNumber: serializeEstimate(estimate).roomNumber,
      revision: estimate.published_snapshot ? JSON.parse(estimate.published_snapshot).revision : estimate.revision,
      estimate: serializeEstimate(estimate),
      alreadyRequested: estimate.status === 'application_requested',
      existingApplication: existing ? { id: existing.id, status: existing.status } : null,
    },
  });
});

rental.post('/api/liff/rental/estimates/:id/application-request', async (c) => {
  try {
    const identity = await liffIdentity(c);
    if (identity instanceof Response) return identity;
    const estimate = await getRentalEstimateOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
    if (!estimate?.sent_at) return c.json({ success: false, error: '申込対象が見つかりません' }, 404);

    const existingApplication = await c.env.DB.prepare(
      `SELECT id FROM rental_applications WHERE estimate_id = ? AND deleted_at IS NULL`,
    ).bind(estimate.id).first<{ id: string }>();
    if (existingApplication) {
      return c.json({
        success: true,
        data: {
          requested: true,
          alreadyRequested: true,
          alreadySubmitted: true,
          notificationSent: false,
        },
      });
    }

    if (!['quote_presented', 'application_requested'].includes(estimate.status)) {
      return c.json({ success: false, error: 'この見積では審査申込希望を受け付けできません' }, 409);
    }
    const body = await c.req.json<{ expectedRevision?: number }>().catch(() => ({} as { expectedRevision?: number }));
    const shownRevision = estimate.published_snapshot ? JSON.parse(estimate.published_snapshot).revision : estimate.revision;
    if (estimate.status !== 'application_requested' && body.expectedRevision !== shownRevision) return c.json({ success: false, error: '見積が更新されています。内容を確認してから、もう一度お進みください。' }, 409);

    const noticeText = [
      `【審査申込希望】${estimate.property_name} ${serializeEstimate(estimate).roomNumber}（提示内容版 ${shownRevision}）`,
      `estimate_id: ${estimate.id}`,
      `request_id: ${estimate.request_id}`,
      'お客様がこの部屋で審査申込を希望しています。',
      '管理会社ごとの手続きに合わせて、LINEで個別対応してください。',
    ].join('\n');
    const existingNotice = await c.env.DB.prepare(
      `SELECT id FROM messages_log
       WHERE friend_id = ? AND direction = 'incoming' AND source = 'rental_application_requested'
         AND content LIKE ?
       LIMIT 1`,
    ).bind(identity.friend.id, `%${estimate.id}%`).first<{ id: string }>();

    const now = jstNow();
    await c.env.DB.prepare('INSERT OR IGNORE INTO rental_application_requests(estimate_id, friend_id, snapshot, requested_at) VALUES (?, ?, ?, ?)')
      .bind(estimate.id, identity.friend.id, JSON.stringify(serializeEstimate(estimate)), now).run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO rental_customer_support(friend_id, enabled_at) VALUES (?, ?)').bind(identity.friend.id, now).run();
    if (estimate.status !== 'application_requested') {
      await c.env.DB.prepare(
        `UPDATE rental_estimates SET status = 'application_requested', updated_at = ? WHERE id = ?`,
      ).bind(now, estimate.id).run();
      await syncRequestStatus(c.env.DB, estimate.request_id);
    }
    await setRentalStatusTag(c, identity.friend.id, RENTAL_STATUS_LABELS.application_requested);

    if (!existingNotice) {
      await c.env.DB.prepare(
        `INSERT INTO messages_log (
           id, friend_id, direction, message_type, content, source, line_account_id, created_at
         ) VALUES (?, ?, 'incoming', 'text', ?, 'rental_application_requested', ?, ?)`,
      ).bind(crypto.randomUUID(), identity.friend.id, noticeText, identity.friend.line_account_id, now).run();
      await upsertChatOnMessage(c.env.DB, identity.friend.id);
    }

    await writeRentalAuditLog(c.env.DB, {
      actorType: 'line_user',
      actorId: identity.lineUserId,
      action: 'request_application',
      entityType: 'estimate',
      entityId: estimate.id,
      metadata: {
        requestId: estimate.request_id,
        alreadyRequested: estimate.status === 'application_requested' || Boolean(existingNotice),
      },
    });

    let notificationSent = false;
    if (!existingNotice) {
      notificationSent = true;
      try {
        await sendLineText(c, identity.friend, applicationRequestReceiptMessage(), 'rental_application_request_receipt');
      } catch (error) {
        notificationSent = false;
        console.error('rental application request receipt push failed:', errorMessage(error));
      }
    }

    return c.json({
      success: true,
      data: {
        requested: true,
        alreadyRequested: estimate.status === 'application_requested' || Boolean(existingNotice),
        notificationSent,
      },
    });
  } catch (error) {
    console.error('POST rental application request:', error);
    return c.json({ success: false, error: '審査申込希望を受け付けできませんでした' }, 500);
  }
});

const APPLICATION_TEXT_FIELDS = [
  'fullName', 'fullNameKana', 'birthDate', 'gender', 'phone', 'email',
  'currentPostalCode', 'currentAddress', 'residenceType', 'employmentCategory',
  'employerName', 'employerPhone', 'employerAddress', 'employmentType',
  'desiredMoveInDate', 'emergencyName', 'emergencyNameKana',
  'emergencyRelationship', 'emergencyPhone', 'emergencyAddress', 'petInfo',
  'vehicleInfo', 'motorbikeInfo', 'bicycleParkingInfo', 'customerNote',
] as const;

rental.post('/api/liff/rental/estimates/:id/applications', async (c) => {
  try {
    const identity = await liffIdentity(c);
    if (identity instanceof Response) return identity;
    const estimate = await getRentalEstimateOwnedByLineUser(c.env.DB, c.req.param('id'), identity.lineUserId);
    if (!estimate) return c.json({ success: false, error: '申込対象が見つかりません' }, 404);
    if (!['quote_presented', 'application_requested'].includes(estimate.status)) {
      return c.json({ success: false, error: 'この見積は審査申込できません' }, 409);
    }
    const existing = await c.env.DB.prepare(
      `SELECT id FROM rental_applications WHERE estimate_id = ? AND deleted_at IS NULL`,
    ).bind(estimate.id).first<{ id: string }>();
    if (existing) return c.json({ success: false, error: 'この見積は申込済みです', applicationId: existing.id }, 409);

    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const normalized = Object.fromEntries(
      APPLICATION_TEXT_FIELDS.map((field) => [field, normalizeOptionalText(body[field], field === 'customerNote' ? 2000 : 500)]),
    ) as Record<(typeof APPLICATION_TEXT_FIELDS)[number], string | null>;
    const required = [
      'fullName', 'fullNameKana', 'birthDate', 'gender', 'phone', 'email',
      'currentPostalCode', 'currentAddress', 'residenceType', 'employmentCategory',
      'employerName', 'employerPhone', 'employerAddress', 'employmentType',
      'desiredMoveInDate', 'emergencyName', 'emergencyNameKana',
      'emergencyRelationship', 'emergencyPhone', 'emergencyAddress',
    ] as const;
    const missing = required.find((field) => !normalized[field]);
    if (missing) return c.json({ success: false, error: `必須項目が未入力です: ${missing}` }, 400);
    if (![body.consentPrivacy, body.consentDataSharing, body.confirmedAccurate, body.consentAdditionalInfo].every((v) => v === true)) {
      return c.json({ success: false, error: 'すべての確認・同意が必要です' }, 400);
    }
    const residenceYears = nonNegativeInteger(body.residenceYears);
    const yearsEmployed = nonNegativeInteger(body.yearsEmployed);
    const annualIncome = nonNegativeInteger(body.annualIncome);
    const occupantsCount = nonNegativeInteger(body.occupantsCount);
    if (residenceYears == null || yearsEmployed == null || annualIncome == null || !occupantsCount) {
      return c.json({ success: false, error: '年数・年収・入居人数を正しく入力してください' }, 400);
    }
    const cohabitants = Array.isArray(body.cohabitants)
      ? body.cohabitants.slice(0, 10).map((value) => {
          const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          return {
            name: normalizeOptionalText(row.name, 200),
            relationship: normalizeOptionalText(row.relationship, 100),
            birthDate: normalizeOptionalText(row.birthDate, 10),
          };
        })
      : [];
    if (!/^\S+@\S+\.\S+$/.test(normalized.email!)) return c.json({ success: false, error: 'メールアドレスが正しくありません' }, 400);
    if (!/^[0-9+()\-\s]{8,20}$/.test(normalized.phone!)) return c.json({ success: false, error: '電話番号が正しくありません' }, 400);
    const id = crypto.randomUUID();
    const now = jstNow();
    await c.env.DB.prepare(
      `INSERT INTO rental_applications (
        id, request_id, estimate_id, friend_id, status,
        full_name, full_name_kana, birth_date, gender, phone, email,
        current_postal_code, current_address, residence_type, residence_years,
        employment_category, employer_name, employer_phone, employer_address,
        employment_type, years_employed, annual_income, desired_move_in_date,
        occupants_count, cohabitant_present, cohabitants_json,
        emergency_name, emergency_name_kana, emergency_relationship,
        emergency_phone, emergency_address, pet_info, vehicle_info,
        motorbike_info, bicycle_parking_info, customer_note,
        consent_privacy, consent_data_sharing, confirmed_accurate,
        consent_additional_info, consented_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 'application_submitted',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?, ?
      )`,
    ).bind(
      id, estimate.request_id, estimate.id, identity.friend.id,
      normalized.fullName, normalized.fullNameKana, normalized.birthDate,
      normalized.gender, normalized.phone, normalized.email,
      normalized.currentPostalCode, normalized.currentAddress, normalized.residenceType, residenceYears,
      normalized.employmentCategory, normalized.employerName, normalized.employerPhone,
      normalized.employerAddress, normalized.employmentType, yearsEmployed, annualIncome,
      normalized.desiredMoveInDate, occupantsCount, body.cohabitantPresent === true ? 1 : 0,
      JSON.stringify(cohabitants), normalized.emergencyName, normalized.emergencyNameKana,
      normalized.emergencyRelationship, normalized.emergencyPhone, normalized.emergencyAddress,
      normalized.petInfo, normalized.vehicleInfo, normalized.motorbikeInfo,
      normalized.bicycleParkingInfo, normalized.customerNote, now, now, now,
    ).run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO rental_customer_support(friend_id, enabled_at) VALUES (?, ?)').bind(identity.friend.id, now).run();
    await c.env.DB.prepare(
      `UPDATE rental_estimates SET status = 'application_submitted', updated_at = ? WHERE id = ?`,
    ).bind(now, estimate.id).run();
    await syncRequestStatus(c.env.DB, estimate.request_id);
    await setRentalStatusTag(c, identity.friend.id, '審査申込入力済み');
    await writeRentalAuditLog(c.env.DB, {
      actorType: 'line_user', actorId: identity.lineUserId, action: 'create',
      entityType: 'application', entityId: id,
      metadata: { requestId: estimate.request_id, estimateId: estimate.id },
    });
    let notificationSent = true;
    try {
      await sendLineText(c, identity.friend, applicationReceiptMessage(), 'rental_application_receipt');
    } catch (error) {
      notificationSent = false;
      console.error('rental application receipt push failed:', errorMessage(error));
    }
    return c.json({ success: true, data: { applicationId: id, notificationSent } }, 201);
  } catch (error) {
    console.error('POST rental application:', error);
    return c.json({ success: false, error: '審査申込を保存できませんでした' }, 500);
  }
});

rental.post('/api/liff/rental/applications/:id/identity', async (c) => {
  const identity = await liffIdentity(c);
  if (identity instanceof Response) return identity;
  const settings = await getSettings(c.env.DB);
  if (!settings.identity_upload_enabled) {
    return c.json({ success: false, error: '本人確認書類のアップロードは現在無効です' }, 403);
  }
  const application = await c.env.DB.prepare(
    `SELECT a.* FROM rental_applications a
     JOIN friends f ON f.id = a.friend_id
     WHERE a.id = ? AND f.line_user_id = ? AND a.deleted_at IS NULL`,
  ).bind(c.req.param('id'), identity.lineUserId).first<RentalApplication>();
  if (!application) return c.json({ success: false, error: '申込が見つかりません' }, 404);
  const decoded = decodeRentalFile(await c.req.json().catch(() => ({})), 'identity');
  if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
  const key = `rental/identity/${application.id}/${crypto.randomUUID()}.${decoded.extension}`;
  await c.env.IMAGES.put(key, decoded.data, {
    httpMetadata: { contentType: decoded.mimeType },
    customMetadata: { originalFilename: decoded.filename, visibility: 'private', sensitive: 'true' },
  });
  await c.env.DB.prepare(
    `UPDATE rental_applications SET identity_file_key = ?, identity_file_name = ?,
       identity_file_mime = ?, identity_file_size = ?, updated_at = ? WHERE id = ?`,
  ).bind(key, decoded.filename, decoded.mimeType, decoded.data.byteLength, jstNow(), application.id).run();
  if (application.identity_file_key) await c.env.IMAGES.delete(application.identity_file_key);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'line_user', actorId: identity.lineUserId, action: 'upload_file',
    entityType: 'application', entityId: application.id,
    metadata: { kind: 'identity', mimeType: decoded.mimeType, size: decoded.data.byteLength },
  });
  return c.json({ success: true, data: { uploaded: true } });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

rental.get('/api/rental/settings', requireRole('owner', 'admin', 'staff'), async (c) => {
  const settings = await getSettings(c.env.DB);
  return c.json({ success: true, data: {
    privacyPolicyUrl: settings.privacy_policy_url,
    identityUploadEnabled: Boolean(settings.identity_upload_enabled),
    dataRetentionDays: settings.data_retention_days,
    richMenuGroupMap: JSON.parse(settings.rich_menu_group_map || '{}'),
    updatedAt: settings.updated_at,
  } });
});

rental.patch('/api/rental/settings', requireRole('owner'), async (c) => {
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const days = nonNegativeInteger(body.dataRetentionDays);
  if (days == null || days < 30 || days > 3650) return c.json({ success: false, error: '保持期間は30〜3650日です' }, 400);
  const privacyUrl = normalizeOptionalText(body.privacyPolicyUrl, 2000);
  if (privacyUrl) {
    try {
      if (new URL(privacyUrl).protocol !== 'https:') throw new Error('HTTPS required');
    } catch { return c.json({ success: false, error: 'プライバシーポリシーURLはHTTPSで指定してください' }, 400); }
  }
  const now = jstNow();
  const rawMap = body.richMenuGroupMap && typeof body.richMenuGroupMap === 'object'
    ? body.richMenuGroupMap as Record<string, unknown>
    : {};
  const richMenuGroupMap = {
    initial: normalizeOptionalText(rawMap.initial, 100),
    quotePresented: normalizeOptionalText(rawMap.quotePresented, 100),
    application: normalizeOptionalText(rawMap.application, 100),
  };
  for (const groupId of Object.values(richMenuGroupMap).filter((value): value is string => Boolean(value))) {
    const exists = await c.env.DB.prepare(
      `SELECT 1 FROM rich_menu_groups WHERE id = ? AND status = 'published'`,
    ).bind(groupId).first();
    if (!exists) return c.json({ success: false, error: `公開済みリッチメニューグループが見つかりません: ${groupId}` }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE rental_settings SET privacy_policy_url = ?, identity_upload_enabled = ?,
       data_retention_days = ?, rich_menu_group_map = ?, updated_at = ? WHERE id = 'default'`,
  ).bind(privacyUrl, body.identityUploadEnabled === true ? 1 : 0, days, JSON.stringify(richMenuGroupMap), now).run();
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'update_settings', entityType: 'settings', entityId: 'default',
    metadata: { dataRetentionDays: days, identityUploadEnabled: body.identityUploadEnabled === true, richMenuPhases: Object.keys(richMenuGroupMap).filter((key) => Boolean(richMenuGroupMap[key as keyof typeof richMenuGroupMap])) },
  });
  return c.json({ success: true, data: null });
});

rental.get('/api/rental/requests', requireRole('owner', 'admin', 'staff'), async (c) => {
  const search = (c.req.query('search') || '').trim();
  const status = c.req.query('status');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 100);
  const conditions = ['r.deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (status && isRentalStatus(status)) { conditions.push('r.status = ?'); binds.push(status); }
  if (search) {
    const like = `%${search.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(`(r.id LIKE ? ESCAPE '\\' OR f.line_user_id LIKE ? ESCAPE '\\' OR f.display_name LIKE ? ESCAPE '\\'
      OR r.nickname LIKE ? ESCAPE '\\' OR r.property_name LIKE ? ESCAPE '\\' OR COALESCE(r.property_url, '') LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM rental_estimates se WHERE se.request_id = r.id AND se.room_number LIKE ? ESCAPE '\\'))`);
    binds.push(like, like, like, like, like, like, like);
  }
  const requests = await c.env.DB.prepare(
    `SELECT r.*, f.line_user_id, f.display_name
     FROM rental_quote_requests r JOIN friends f ON f.id = r.friend_id
     WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(...binds, limit).all<Record<string, unknown>>();
  const items = [];
  for (const request of requests.results) {
    const estimates = await c.env.DB.prepare(
      `SELECT * FROM rental_estimates WHERE request_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
    ).bind(request.id).all<RentalEstimate>();
    const accepted = await c.env.DB.prepare('SELECT estimate_id, snapshot FROM rental_application_requests WHERE friend_id = ?')
      .bind(request.friend_id).all<{ estimate_id: string; snapshot: string }>();
    const deliveries = await c.env.DB.prepare('SELECT status, revisions FROM rental_quote_deliveries WHERE request_id = ? ORDER BY created_at DESC')
      .bind(request.id).all<{ status: string; revisions: string }>();
    items.push({ ...request, estimates: estimates.results.map((row) => ({ ...serializeEstimate(row, true),
      notificationStatus: deliveries.results.find((delivery) => JSON.parse(delivery.revisions).some((r: { id: string; revision: number }) => r.id === row.id && r.revision === (row.published_snapshot ? JSON.parse(row.published_snapshot).revision : null)))?.status ?? null,
      requestedQuote: accepted.results.find((a) => a.estimate_id === row.id)?.snapshot ? JSON.parse(accepted.results.find((a) => a.estimate_id === row.id)!.snapshot) : null })) });
  }
  return c.json({ success: true, data: items });
});

rental.get('/api/rental/requests/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const request = await c.env.DB.prepare(
    `SELECT r.*, f.line_user_id, f.display_name FROM rental_quote_requests r
     JOIN friends f ON f.id = r.friend_id WHERE r.id = ? AND r.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!request) return c.json({ success: false, error: '見積依頼が見つかりません' }, 404);
  const estimates = await c.env.DB.prepare(
    `SELECT * FROM rental_estimates WHERE request_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
  ).bind(c.req.param('id')).all<RentalEstimate>();
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'view', entityType: 'quote_request', entityId: c.req.param('id')!,
  });
  return c.json({ success: true, data: { ...request, estimates: estimates.results.map((row) => serializeEstimate(row, true)) } });
});

rental.patch('/api/rental/estimates/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const estimate = await c.env.DB.prepare(
    `SELECT * FROM rental_estimates WHERE id = ? AND deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<RentalEstimate>();
  if (!estimate) return c.json({ success: false, error: '見積が見つかりません' }, 404);
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const camelToColumn: Record<string, string> = {
    monthlyOtherCost: 'monthly_other_cost',
    rent: 'rent', managementFee: 'management_fee', deposit: 'deposit', keyMoney: 'key_money',
    advanceRent: 'advance_rent', proratedRent: 'prorated_rent', fireInsurance: 'fire_insurance',
    guaranteeCompanyFee: 'guarantee_company_fee', keyExchangeFee: 'key_exchange_fee',
    cleaningFee: 'cleaning_fee', otherInitialCost: 'other_initial_cost', brokerageFee: 'brokerage_fee',
    brokerageDiscount: 'brokerage_discount', cashback: 'cashback',
  };
  const sets: string[] = [];
  const binds: unknown[] = [];
  const totals: Record<string, unknown> = {};
  if ('roomNumber' in body) {
    const room = normalizeOptionalText(typeof body.roomNumber === 'string' ? body.roomNumber.normalize('NFKC').replace(/\s*号室$/, '').trim() : null, 50);
    if (!room) return c.json({ success: false, error: '部屋番号を入力してください' }, 400);
    const siblings = await c.env.DB.prepare('SELECT room_number FROM rental_estimates WHERE request_id = ? AND id != ? AND deleted_at IS NULL')
      .bind(estimate.request_id, estimate.id).all<{ room_number: string }>();
    if (siblings.results.some((row) => row.room_number.normalize('NFKC').replace(/\s*号室$/, '').trim() === room)) return c.json({ success: false, error: '同じ依頼に部屋番号が重複しています' }, 400);
    sets.push('room_number = ?'); binds.push(room);
  }
  for (const [camel, column] of Object.entries(camelToColumn)) {
    if (!(camel in body)) continue;
    const value = body[camel] === '' || body[camel] == null ? null : nonNegativeInteger(body[camel]);
    if (body[camel] !== '' && body[camel] != null && value == null) return c.json({ success: false, error: `${camel} は0以上の整数で入力してください` }, 400);
    sets.push(`${column} = ?`); binds.push(value); totals[column] = value;
  }
  const mergedTotals = Object.fromEntries(ESTIMATE_MONEY_FIELDS.map((field) => [field, field in totals ? totals[field] : estimate[field]]));
  if (Object.keys(totals).length > 0) {
    const price = rentalPricing(estimatePriceValues(mergedTotals));
    if (price.invalidDiscount || price.invalidCashback) return c.json({ success: false, error: '割引・キャッシュバックが対象の費用を超えています' }, 400);
    sets.push('payment_total = ?', 'pricing_version = 1'); binds.push(calculatePaymentTotal(mergedTotals));
  }
  if ('managerMemo' in body) { sets.push('manager_memo = ?'); binds.push(normalizeOptionalText(body.managerMemo, 5000)); }
  if ('customerNotes' in body) { sets.push('customer_notes = ?'); binds.push(normalizeOptionalText(body.customerNotes, 3000)); }
  if ('status' in body) {
    if (!isRentalStatus(body.status)) return c.json({ success: false, error: 'ステータスが不正です' }, 400);
    sets.push('status = ?'); binds.push(body.status);
  }
  if (sets.length === 0) return c.json({ success: false, error: '更新項目がありません' }, 400);
  if (!Number.isSafeInteger(body.expectedRevision)) return c.json({ success: false, error: '再読み込みして保存してください' }, 409);
  sets.push('updated_at = ?', 'revision = revision + 1'); binds.push(jstNow(), estimate.id, body.expectedRevision);
  const changed = await c.env.DB.prepare(`UPDATE rental_estimates SET ${sets.join(', ')} WHERE id = ? AND revision = ? AND send_lock IS NULL`).bind(...binds).run();
  if (changed.meta.changes !== 1) return c.json({ success: false, error: '別の編集・送信があります。再読み込みしてください' }, 409);
  const requestStatus = await syncRequestStatus(c.env.DB, estimate.request_id);
  const request = await c.env.DB.prepare(`SELECT friend_id FROM rental_quote_requests WHERE id = ?`).bind(estimate.request_id).first<{ friend_id: string }>();
  if (request) await setRentalStatusTag(c, request.friend_id, RENTAL_STATUS_LABELS[requestStatus]);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'update', entityType: 'estimate', entityId: estimate.id,
    metadata: { fields: Object.keys(body) },
  });
  const updated = await c.env.DB.prepare(`SELECT * FROM rental_estimates WHERE id = ?`).bind(estimate.id).first<RentalEstimate>();
  return c.json({ success: true, data: updated ? serializeEstimate(updated, true) : null });
});

rental.post('/api/rental/estimates/:id/floor-plan', requireRole('owner', 'admin', 'staff'), async (c) => {
  const estimate = await c.env.DB.prepare(`SELECT * FROM rental_estimates WHERE id = ? AND deleted_at IS NULL`).bind(c.req.param('id')).first<RentalEstimate>();
  if (!estimate) return c.json({ success: false, error: '見積が見つかりません' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (body.expectedRevision !== estimate.revision) return c.json({ success: false, error: '再読み込みして図面を添付してください' }, 409);
  const decoded = decodeRentalFile(body, 'floor-plan');
  if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
  const key = `rental/floor-plans/${estimate.id}/${crypto.randomUUID()}.${decoded.extension}`;
  await c.env.IMAGES.put(key, decoded.data, {
    httpMetadata: { contentType: decoded.mimeType },
    customMetadata: { originalFilename: decoded.filename, visibility: 'private' },
  });
  const changed = await c.env.DB.prepare(
    `UPDATE rental_estimates SET floor_plan_key = ?, floor_plan_name = ?, floor_plan_mime = ?, floor_plan_size = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND send_lock IS NULL`,
  ).bind(key, decoded.filename, decoded.mimeType, decoded.data.byteLength, jstNow(), estimate.id, body.expectedRevision).run();
  if (changed.meta.changes !== 1) { await c.env.IMAGES.delete(key); return c.json({ success: false, error: '別の編集・送信があります。再読み込みしてください' }, 409); }
  // Previous files remain available to immutable presented versions.
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'upload_file', entityType: 'estimate', entityId: estimate.id,
    metadata: { kind: 'floor_plan', mimeType: decoded.mimeType, size: decoded.data.byteLength },
  });
  return c.json({ success: true, data: { name: decoded.filename, size: decoded.data.byteLength } });
});

rental.get('/api/rental/estimates/:id/floor-plan', requireRole('owner', 'admin', 'staff'), async (c) => {
  const estimate = await c.env.DB.prepare(`SELECT * FROM rental_estimates WHERE id = ? AND deleted_at IS NULL`).bind(c.req.param('id')).first<RentalEstimate>();
  if (!estimate?.floor_plan_key) return c.json({ success: false, error: '図面が見つかりません' }, 404);
  const object = await c.env.IMAGES.get(estimate.floor_plan_key);
  if (!object) return c.json({ success: false, error: '図面が見つかりません' }, 404);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'view_file', entityType: 'estimate', entityId: estimate.id,
  });
  return new Response(object.body, { headers: {
    'Content-Type': estimate.floor_plan_mime || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(estimate.floor_plan_name || 'floor-plan')}`,
    'X-Content-Type-Options': 'nosniff',
  } });
});

async function sendRentalRequest(c: any, requestId: string, revisions: Array<{ id: string; revision: number }>) {
  if (!revisions.length || revisions.length > 5 || new Set(revisions.map((r) => r.id)).size !== revisions.length || revisions.some((r) => typeof r.id !== 'string' || !Number.isSafeInteger(r.revision))) return c.json({ success: false, error: '送信対象を確認してください' }, 400);
  try {
    const result = await publishRentalQuotes(c, { requestId, revisions,
      snapshot: (row) => { const { managerMemo, publishedRevision, ...customer } = serializeEstimate(row, true); return customer; },
      listUrl: (friend) => liffDeepLink(c, '/rental/requests/' + requestId, friend),
    });
    const status = await syncRequestStatus(c.env.DB, requestId);
    const request = await c.env.DB.prepare('SELECT friend_id FROM rental_quote_requests WHERE id = ?').bind(requestId).first();
    if (request) await setRentalStatusTag(c, request.friend_id, RENTAL_STATUS_LABELS[status]).catch(() => console.error('rental tag update failed'));
    await writeRentalAuditLog(c.env.DB, { actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
      action: 'send_quote', entityType: 'quote_request', entityId: requestId, metadata: { revisions, notificationSent: result.notificationSent } });
    return c.json({ success: true, data: result });
  } catch (error) { return c.json({ success: false, error: errorMessage(error) }, 409); }
}
rental.post('/api/rental/estimates/:id/send', requireRole('owner', 'admin', 'staff'), async (c) => {
  const estimate = await c.env.DB.prepare('SELECT request_id FROM rental_estimates WHERE id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id')).first<{ request_id: string }>();
  if (!estimate) return c.json({ success: false, error: '見積が見つかりません' }, 404);
  const body = await c.req.json<{ expectedRevision?: number }>().catch(() => ({} as { expectedRevision?: number }));
  return sendRentalRequest(c, estimate.request_id, [{ id: c.req.param('id')!, revision: body.expectedRevision as number }]);
});
rental.post('/api/rental/requests/:id/send', requireRole('owner', 'admin', 'staff'), async (c) => {
  const body = await c.req.json<{ revisions?: Array<{ id: string; revision: number }> }>().catch(() => ({} as { revisions?: Array<{ id: string; revision: number }> }));
  return sendRentalRequest(c, c.req.param('id')!, Array.isArray(body.revisions) ? body.revisions : []);
});

function applicationSelect(): string {
  return `SELECT a.*, r.property_name, r.property_url, e.room_number,
    f.line_user_id, f.display_name
    FROM rental_applications a
    JOIN rental_quote_requests r ON r.id = a.request_id
    JOIN rental_estimates e ON e.id = a.estimate_id
    JOIN friends f ON f.id = a.friend_id`;
}

rental.get('/api/rental/applications/export.csv', requireRole('owner', 'admin'), async (c) => {
  const rows = await c.env.DB.prepare(`${applicationSelect()} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC`).all<RentalApplication>();
  const columns = [
    'application_id', 'request_id', 'estimate_id', 'status', 'property_name', 'room_number',
    'line_user_id', 'full_name', 'full_name_kana', 'birth_date', 'phone', 'email',
    'current_address', 'employer_name', 'annual_income', 'desired_move_in_date', 'created_at',
  ];
  const body = [columns.map(csvCell).join(','), ...rows.results.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n');
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'export_csv', entityType: 'application', entityId: 'bulk',
    metadata: { count: rows.results.length },
  });
  return new Response(`\uFEFF${body}`, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="rental-applications.csv"',
    'Cache-Control': 'no-store',
  } });
});

rental.get('/api/rental/applications', requireRole('owner', 'admin'), async (c) => {
  const conditions = ['a.deleted_at IS NULL'];
  const binds: unknown[] = [];
  const status = c.req.query('status');
  if (status && isRentalApplicationStatus(status)) { conditions.push('a.status = ?'); binds.push(status); }
  const search = (c.req.query('search') || '').trim();
  if (search) {
    const like = `%${search.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(`(a.id LIKE ? ESCAPE '\\' OR f.line_user_id LIKE ? ESCAPE '\\' OR r.property_name LIKE ? ESCAPE '\\' OR COALESCE(r.property_url, '') LIKE ? ESCAPE '\\' OR e.room_number LIKE ? ESCAPE '\\')`);
    binds.push(like, like, like, like, like);
  }
  const rows = await c.env.DB.prepare(`${applicationSelect()} WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC LIMIT 100`).bind(...binds).all<RentalApplication>();
  const data = rows.results.map((row) => ({
    id: row.id, requestId: row.request_id, estimateId: row.estimate_id,
    status: row.status, statusLabel: RENTAL_APPLICATION_STATUS_LABELS[row.status],
    propertyName: row.property_name, roomNumber: row.room_number,
    lineUserId: row.line_user_id, displayName: row.display_name,
    createdAt: row.created_at, anonymizedAt: row.anonymized_at,
  }));
  return c.json({ success: true, data });
});

rental.get('/api/rental/applications/:id/identity', requireRole('owner', 'admin'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM rental_applications WHERE id = ? AND deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<RentalApplication>();
  if (!row?.identity_file_key) return c.json({ success: false, error: '本人確認書類が見つかりません' }, 404);
  const object = await c.env.IMAGES.get(row.identity_file_key);
  if (!object) return c.json({ success: false, error: '本人確認書類が見つかりません' }, 404);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'view_sensitive_file', entityType: 'application', entityId: row.id,
  });
  return new Response(object.body, { headers: {
    'Content-Type': row.identity_file_mime || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.identity_file_name || 'identity')}`,
    'X-Content-Type-Options': 'nosniff',
  } });
});

rental.get('/api/rental/applications/:id', requireRole('owner', 'admin'), async (c) => {
  const row = await c.env.DB.prepare(`${applicationSelect()} WHERE a.id = ? AND a.deleted_at IS NULL`).bind(c.req.param('id')).first<RentalApplication>();
  if (!row) return c.json({ success: false, error: '申込が見つかりません' }, 404);
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'view_pii', entityType: 'application', entityId: row.id,
  });
  return c.json({ success: true, data: row });
});

rental.patch('/api/rental/applications/:id', requireRole('owner', 'admin'), async (c) => {
  const row = await c.env.DB.prepare(`${applicationSelect()} WHERE a.id = ? AND a.deleted_at IS NULL`).bind(c.req.param('id')).first<RentalApplication>();
  if (!row) return c.json({ success: false, error: '申込が見つかりません' }, 404);
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('status' in body) {
    if (!isRentalApplicationStatus(body.status)) return c.json({ success: false, error: 'ステータスが不正です' }, 400);
    sets.push('status = ?'); binds.push(body.status);
  }
  if ('managerMemo' in body) { sets.push('manager_memo = ?'); binds.push(normalizeOptionalText(body.managerMemo, 5000)); }
  if (!sets.length) return c.json({ success: false, error: '更新項目がありません' }, 400);
  sets.push('updated_at = ?'); binds.push(jstNow(), row.id);
  await c.env.DB.prepare(`UPDATE rental_applications SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  const nextStatus = body.status;
  if (isRentalApplicationStatus(nextStatus)) {
    const estimateStatus: RentalStatus = nextStatus === 'contracted'
      ? 'contracted'
      : nextStatus === 'cancelled'
        ? 'cancelled'
        : ['application_submitted', 'reviewing'].includes(nextStatus)
          ? 'application_submitted'
          : 'individual_followup';
    await c.env.DB.prepare(
      `UPDATE rental_estimates SET status = ?, updated_at = ? WHERE id = ?`,
    ).bind(estimateStatus, jstNow(), row.estimate_id).run();
    await syncRequestStatus(c.env.DB, row.request_id);
    await setRentalStatusTag(c, row.friend_id, RENTAL_APPLICATION_STATUS_LABELS[nextStatus]);
  }
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'update', entityType: 'application', entityId: row.id,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: null });
});

rental.post('/api/rental/applications/:id/message', requireRole('owner', 'admin'), async (c) => {
  const row = await c.env.DB.prepare(`${applicationSelect()} WHERE a.id = ? AND a.deleted_at IS NULL`).bind(c.req.param('id')).first<RentalApplication>();
  if (!row) return c.json({ success: false, error: '申込が見つかりません' }, 404);
  const body: { template?: unknown } = await c.req.json<{ template?: unknown }>().catch(() => ({}));
  const template = typeof body.template === 'string' ? body.template : '';
  const text = RENTAL_SAFE_LINE_MESSAGES[template as keyof typeof RENTAL_SAFE_LINE_MESSAGES];
  if (!text) return c.json({ success: false, error: '許可されたメッセージテンプレートを選択してください' }, 400);
  const friend = await getFriendById(c.env.DB, row.friend_id);
  if (!friend) return c.json({ success: false, error: 'LINE友だちが見つかりません' }, 404);
  await sendLineText(c, friend, text, 'rental_manual');
  await writeRentalAuditLog(c.env.DB, {
    actorType: 'staff', actorId: c.get('staff').id, actorName: c.get('staff').name,
    action: 'send_line', entityType: 'application', entityId: row.id,
    metadata: { length: text.length },
  });
  return c.json({ success: true, data: null });
});

async function anonymizeApplication(c: any, row: RentalApplication, reason: string): Promise<void> {
  const now = jstNow();
  await c.env.DB.prepare(
    `UPDATE rental_applications SET
      full_name = NULL, full_name_kana = NULL, birth_date = NULL, gender = NULL,
      phone = NULL, email = NULL, current_postal_code = NULL, current_address = NULL,
      residence_type = NULL, residence_years = NULL, employment_category = NULL,
      employer_name = NULL, employer_phone = NULL, employer_address = NULL,
      employment_type = NULL, years_employed = NULL, annual_income = NULL,
      desired_move_in_date = NULL, occupants_count = NULL, cohabitant_present = NULL,
      cohabitants_json = '[]', emergency_name = NULL, emergency_name_kana = NULL,
      emergency_relationship = NULL, emergency_phone = NULL, emergency_address = NULL,
      pet_info = NULL, vehicle_info = NULL, motorbike_info = NULL,
      bicycle_parking_info = NULL, customer_note = NULL, identity_file_key = NULL,
      identity_file_name = NULL, identity_file_mime = NULL, identity_file_size = NULL,
      manager_memo = NULL, anonymized_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(now, now, row.id).run();
  if (row.identity_file_key) await c.env.IMAGES.delete(row.identity_file_key);
  await writeRentalAuditLog(c.env.DB, {
    actorType: reason === 'retention' ? 'system' : 'staff',
    actorId: reason === 'retention' ? null : c.get('staff').id,
    actorName: reason === 'retention' ? null : c.get('staff').name,
    action: 'anonymize', entityType: 'application', entityId: row.id,
    metadata: { reason },
  });
}

rental.delete('/api/rental/applications/:id', requireRole('owner'), async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM rental_applications WHERE id = ? AND deleted_at IS NULL`).bind(c.req.param('id')).first<RentalApplication>();
  if (!row) return c.json({ success: false, error: '申込が見つかりません' }, 404);
  await anonymizeApplication(c, row, 'manual');
  return c.json({ success: true, data: null });
});

rental.post('/api/rental/retention/run', requireRole('owner'), async (c) => {
  const settings = await getSettings(c.env.DB);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM rental_applications
     WHERE deleted_at IS NULL AND anonymized_at IS NULL
       AND datetime(created_at) < datetime('now', '-' || ? || ' days')`,
  ).bind(settings.data_retention_days).all<RentalApplication>();
  for (const row of rows.results) await anonymizeApplication(c, row, 'retention');
  return c.json({ success: true, data: { anonymized: rows.results.length } });
});

rental.get('/api/rental/audit-logs', requireRole('owner', 'admin'), async (c) => {
  const entityId = c.req.query('entityId');
  const rows = entityId
    ? await c.env.DB.prepare(`SELECT * FROM rental_audit_logs WHERE entity_id = ? ORDER BY created_at DESC LIMIT 200`).bind(entityId).all()
    : await c.env.DB.prepare(`SELECT * FROM rental_audit_logs ORDER BY created_at DESC LIMIT 200`).all();
  return c.json({ success: true, data: rows.results });
});

export { rental };
