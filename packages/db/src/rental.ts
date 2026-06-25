import { jstNow } from './utils.js';

export const RENTAL_STATUSES = [
  'quote_pending',
  'quote_in_progress',
  'quote_presented',
  'out_of_scope',
  'application_requested',
  'application_submitted',
  'individual_followup',
  'contracted',
  'cancelled',
] as const;

export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_APPLICATION_STATUSES = [
  'application_submitted',
  'reviewing',
  'additional_information',
  'preparing_submission',
  'submitted_to_partner',
  'screening',
  'approved',
  'rejected',
  'formal_estimate_presented',
  'contract_in_progress',
  'contracted',
  'cancelled',
] as const;

export type RentalApplicationStatus = (typeof RENTAL_APPLICATION_STATUSES)[number];

export interface RentalQuoteRequest {
  id: string;
  friend_id: string;
  property_name: string;
  property_url: string | null;
  desired_move_in_date: string;
  nickname: string;
  has_pets: number;
  needs_parking: number;
  has_motorbike: number;
  needs_bicycle_parking: number;
  status: RentalStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RentalEstimate {
  id: string;
  request_id: string;
  room_number: string;
  sort_order: number;
  rent: number | null;
  management_fee: number | null;
  deposit: number | null;
  key_money: number | null;
  advance_rent: number | null;
  prorated_rent: number | null;
  fire_insurance: number | null;
  guarantee_company_fee: number | null;
  key_exchange_fee: number | null;
  cleaning_fee: number | null;
  other_initial_cost: number | null;
  brokerage_fee: number | null;
  brokerage_discount: number | null;
  cashback: number | null;
  payment_total: number | null;
  manager_memo: string | null;
  customer_notes: string | null;
  floor_plan_key: string | null;
  floor_plan_name: string | null;
  floor_plan_mime: string | null;
  floor_plan_size: number | null;
  status: RentalStatus;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateRentalQuoteRequestInput {
  friendId: string;
  propertyName: string;
  propertyUrl?: string | null;
  roomNumbers: string[];
  desiredMoveInDate: string;
  nickname: string;
  hasPets: boolean;
  needsParking: boolean;
  hasMotorbike: boolean;
  needsBicycleParking: boolean;
}

export async function createRentalQuoteRequest(
  db: D1Database,
  input: CreateRentalQuoteRequestInput,
): Promise<{ requestId: string; estimates: Array<{ id: string; roomNumber: string }> }> {
  const requestId = crypto.randomUUID();
  const now = jstNow();
  const estimates = input.roomNumbers.map((roomNumber) => ({
    id: crypto.randomUUID(),
    roomNumber,
  }));

  const statements = [
    db.prepare(
      `INSERT INTO rental_quote_requests (
         id, friend_id, property_name, property_url, desired_move_in_date,
         nickname, has_pets, needs_parking, has_motorbike,
         needs_bicycle_parking, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quote_pending', ?, ?)`,
    ).bind(
      requestId,
      input.friendId,
      input.propertyName,
      input.propertyUrl ?? null,
      input.desiredMoveInDate,
      input.nickname,
      input.hasPets ? 1 : 0,
      input.needsParking ? 1 : 0,
      input.hasMotorbike ? 1 : 0,
      input.needsBicycleParking ? 1 : 0,
      now,
      now,
    ),
    ...estimates.map((estimate, index) =>
      db.prepare(
        `INSERT INTO rental_estimates (
           id, request_id, room_number, sort_order, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'quote_pending', ?, ?)`,
      ).bind(estimate.id, requestId, estimate.roomNumber, index, now, now),
    ),
  ];

  await db.batch(statements);
  return { requestId, estimates };
}

export async function getRentalRequestOwnedByLineUser(
  db: D1Database,
  requestId: string,
  lineUserId: string,
): Promise<RentalQuoteRequest | null> {
  return db.prepare(
    `SELECT r.* FROM rental_quote_requests r
     JOIN friends f ON f.id = r.friend_id
     WHERE r.id = ? AND f.line_user_id = ? AND r.deleted_at IS NULL`,
  ).bind(requestId, lineUserId).first<RentalQuoteRequest>();
}

export async function getRentalEstimateOwnedByLineUser(
  db: D1Database,
  estimateId: string,
  lineUserId: string,
): Promise<(RentalEstimate & { friend_id: string; property_name: string; property_url: string | null }) | null> {
  return db.prepare(
    `SELECT e.*, r.friend_id, r.property_name, r.property_url
     FROM rental_estimates e
     JOIN rental_quote_requests r ON r.id = e.request_id
     JOIN friends f ON f.id = r.friend_id
     WHERE e.id = ? AND f.line_user_id = ?
       AND e.deleted_at IS NULL AND r.deleted_at IS NULL`,
  ).bind(estimateId, lineUserId).first<RentalEstimate & {
    friend_id: string;
    property_name: string;
    property_url: string | null;
  }>();
}

export async function writeRentalAuditLog(
  db: D1Database,
  input: {
    actorType: 'staff' | 'line_user' | 'system';
    actorId?: string | null;
    actorName?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO rental_audit_logs (
       id, actor_type, actor_id, actor_name, action, entity_type,
       entity_id, metadata, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.actorType,
    input.actorId ?? null,
    input.actorName ?? null,
    input.action,
    input.entityType,
    input.entityId,
    input.metadata ? JSON.stringify(input.metadata) : null,
    jstNow(),
  ).run();
}
