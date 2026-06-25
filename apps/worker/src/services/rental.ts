import {
  RENTAL_APPLICATION_STATUSES,
  RENTAL_STATUSES,
  type RentalApplicationStatus,
  type RentalStatus,
} from '@line-crm/db';

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  quote_pending: '見積作成待ち',
  quote_in_progress: '見積作成中',
  quote_presented: '見積提示済み',
  out_of_scope: '対象外・確認不可',
  application_requested: '審査申込希望',
  application_submitted: '審査申込入力済み',
  individual_followup: '個別対応中',
  contracted: '成約',
  cancelled: 'キャンセル',
};

export const RENTAL_APPLICATION_STATUS_LABELS: Record<RentalApplicationStatus, string> = {
  application_submitted: '審査申込入力済み',
  reviewing: '内容確認中',
  additional_information: '追加確認中',
  preparing_submission: '管理会社提出準備中',
  submitted_to_partner: '管理会社・保証会社へ提出済み',
  screening: '審査中',
  approved: '審査承認',
  rejected: '審査否認',
  formal_estimate_presented: '正式見積提示済み',
  contract_in_progress: '契約手続き中',
  contracted: '成約',
  cancelled: 'キャンセル',
};

export const RENTAL_SAFE_LINE_MESSAGES = {
  reviewing: '審査申込内容を確認しています。次のご案内までお待ちください。',
  additional_information: '審査申込内容について追加確認事項があります。担当者からのご案内をご確認ください。',
  submitted: '申込情報を提出しました。結果が分かり次第LINEでご案内します。',
  approved: '審査承認の連絡を受けました。契約手続きについて改めてご案内します。',
  followup: 'お手続きについてご案内があります。LINEのトークをご確認ください。',
} as const;

export const ESTIMATE_MONEY_FIELDS = [
  'rent',
  'management_fee',
  'deposit',
  'key_money',
  'advance_rent',
  'prorated_rent',
  'fire_insurance',
  'guarantee_company_fee',
  'key_exchange_fee',
  'cleaning_fee',
  'other_initial_cost',
  'brokerage_fee',
  'brokerage_discount',
  'cashback',
] as const;

export type EstimateMoneyField = (typeof ESTIMATE_MONEY_FIELDS)[number];

export function isRentalStatus(value: unknown): value is RentalStatus {
  return typeof value === 'string' && (RENTAL_STATUSES as readonly string[]).includes(value);
}

export function isRentalApplicationStatus(value: unknown): value is RentalApplicationStatus {
  return typeof value === 'string' && (RENTAL_APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function normalizeOptionalText(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function nonNegativeInteger(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number;
}

export function calculatePaymentTotal(values: Partial<Record<EstimateMoneyField, unknown>>): number {
  const costFields: EstimateMoneyField[] = [
    'rent',
    'management_fee',
    'deposit',
    'key_money',
    'advance_rent',
    'prorated_rent',
    'fire_insurance',
    'guarantee_company_fee',
    'key_exchange_fee',
    'cleaning_fee',
    'other_initial_cost',
    'brokerage_fee',
  ];
  const cost = costFields.reduce((sum, field) => sum + (nonNegativeInteger(values[field]) ?? 0), 0);
  const discounts = (nonNegativeInteger(values.brokerage_discount) ?? 0)
    + (nonNegativeInteger(values.cashback) ?? 0);
  return Math.max(0, cost - discounts);
}

export interface QuoteRequestBody {
  propertyName?: unknown;
  propertyUrl?: unknown;
  roomNumbers?: unknown;
  desiredMoveInDate?: unknown;
  nickname?: unknown;
  hasPets?: unknown;
  needsParking?: unknown;
  hasMotorbike?: unknown;
  needsBicycleParking?: unknown;
}

export function validateQuoteRequestBody(body: QuoteRequestBody):
  | { ok: true; value: {
      propertyName: string;
      propertyUrl: string | null;
      roomNumbers: string[];
      desiredMoveInDate: string;
      nickname: string;
      hasPets: boolean;
      needsParking: boolean;
      hasMotorbike: boolean;
      needsBicycleParking: boolean;
    } }
  | { ok: false; error: string } {
  let propertyName = normalizeOptionalText(body.propertyName, 300);
  const nickname = normalizeOptionalText(body.nickname, 100);
  const desiredMoveInDate = normalizeOptionalText(body.desiredMoveInDate, 10);
  if (!nickname) return { ok: false, error: 'ニックネームは必須です' };
  if (!desiredMoveInDate || !/^\d{4}-\d{2}-\d{2}$/.test(desiredMoveInDate)) {
    return { ok: false, error: '入居希望日は YYYY-MM-DD 形式で入力してください' };
  }

  const rooms = Array.isArray(body.roomNumbers)
    ? body.roomNumbers.map((value) => normalizeOptionalText(value, 50)).filter((value): value is string => Boolean(value))
    : [];
  const uniqueRooms = [...new Set(rooms)];
  if (uniqueRooms.length < 1 || uniqueRooms.length > 5) {
    return { ok: false, error: '部屋番号は1〜5件で入力してください' };
  }

  let propertyUrl = normalizeOptionalText(body.propertyUrl, 2000);
  if (propertyUrl) {
    try {
      const url = new URL(propertyUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
      propertyUrl = url.toString();
    } catch {
      return { ok: false, error: '物件URLが正しくありません' };
    }
  }
  if (!propertyName && !propertyUrl) return { ok: false, error: '物件名または物件URLは必須です' };
  propertyName ??= propertyUrl!;

  const flags = [body.hasPets, body.needsParking, body.hasMotorbike, body.needsBicycleParking];
  if (flags.some((value) => typeof value !== 'boolean')) {
    return { ok: false, error: '設備条件をすべて選択してください' };
  }

  return {
    ok: true,
    value: {
      propertyName,
      propertyUrl,
      roomNumbers: uniqueRooms,
      desiredMoveInDate,
      nickname,
      hasPets: body.hasPets as boolean,
      needsParking: body.needsParking as boolean,
      hasMotorbike: body.hasMotorbike as boolean,
      needsBicycleParking: body.needsBicycleParking as boolean,
    },
  };
}

export type RentalFileKind = 'floor-plan' | 'identity';

export function decodeRentalFile(body: {
  data?: unknown;
  mimeType?: unknown;
  filename?: unknown;
}, kind: RentalFileKind):
  | { ok: true; data: Uint8Array; mimeType: string; filename: string; extension: string }
  | { ok: false; error: string } {
  if (typeof body.data !== 'string' || !body.data) return { ok: false, error: 'ファイルがありません' };
  let encoded = body.data;
  let mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const dataUrl = encoded.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrl) {
    mimeType = dataUrl[1].toLowerCase();
    encoded = dataUrl[2];
  }

  const allowed = kind === 'floor-plan'
    ? ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    : ['application/pdf', 'image/png', 'image/jpeg'];
  if (!allowed.includes(mimeType)) return { ok: false, error: '許可されていないファイル形式です' };

  let data: Uint8Array;
  try {
    data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    return { ok: false, error: 'Base64データが正しくありません' };
  }
  if (data.byteLength < 4 || data.byteLength > 10 * 1024 * 1024) {
    return { ok: false, error: 'ファイルは10MB以下にしてください' };
  }

  const isPdf = data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isWebp = data.byteLength >= 12
    && String.fromCharCode(...data.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...data.slice(8, 12)) === 'WEBP';
  const matches = (mimeType === 'application/pdf' && isPdf)
    || (mimeType === 'image/png' && isPng)
    || (mimeType === 'image/jpeg' && isJpeg)
    || (mimeType === 'image/webp' && isWebp);
  if (!matches) return { ok: false, error: 'ファイル内容とMIMEタイプが一致しません' };

  const extension = mimeType === 'application/pdf'
    ? 'pdf'
    : mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType.split('/')[1];
  const filename = normalizeOptionalText(body.filename, 255) ?? `upload.${extension}`;
  return { ok: true, data, mimeType, filename, extension };
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection when opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function quoteReceiptMessage(): string {
  return '概算見積依頼を受け付けました。\n内容を確認後、LINEで概算見積をご案内します。';
}

export function quoteReadyMessage(listUrl: string): string {
  return [
    '概算見積ができました。',
    '',
    '見積内容と図面をあわせてご確認ください。',
    '審査申込をご希望の場合は、該当する見積の「審査申込へ進む」ボタンからお進みください。',
    '',
    '※概算見積のため、正式な金額は審査通過後の正式見積で確定します。',
    listUrl,
  ].join('\n');
}

export function applicationReceiptMessage(): string {
  return [
    '審査申込情報を受け付けました。',
    '',
    '内容を確認のうえ、物件ごとの申込方法に沿って次の手続きをご案内します。',
    '追加確認が必要な場合は、LINEでご連絡します。',
  ].join('\n');
}
