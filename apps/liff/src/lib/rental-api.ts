import { getIdToken, getLiffId } from './liff-auth.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

function url(path: string): URL {
  const value = new URL(`${BASE}${path}`, window.location.origin);
  value.searchParams.set('liffId', getLiffId());
  return value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${getIdToken()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as { success?: boolean; data?: T; error?: string } : {};
  if (!response.ok) throw new Error(parsed.error || `API ${response.status}`);
  return (parsed.data ?? parsed) as T;
}

export type RentalEstimate = {
  id: string;
  requestId: string;
  roomNumber: string;
  status: string;
  statusLabel: string;
  rent: number | null;
  managementFee: number | null;
  deposit: number | null;
  keyMoney: number | null;
  advanceRent: number | null;
  proratedRent: number | null;
  fireInsurance: number | null;
  guaranteeCompanyFee: number | null;
  keyExchangeFee: number | null;
  cleaningFee: number | null;
  otherInitialCost: number | null;
  brokerageFee: number | null;
  brokerageDiscount: number | null;
  cashback: number | null;
  paymentTotal: number | null;
  customerNotes: string | null;
  hasFloorPlan: boolean;
  floorPlanName: string | null;
};

export const rentalApi = {
  settings: () => request<{ privacyPolicyUrl: string | null; identityUploadEnabled: boolean }>('/api/liff/rental/settings'),
  createQuote: (body: Record<string, unknown>) => request<{
    requestId: string;
    estimates: Array<{ id: string; roomNumber: string }>;
    notificationSent: boolean;
  }>('/api/liff/rental/quote-requests', { method: 'POST', body: JSON.stringify(body) }),
  estimates: (requestId: string) => request<{
    request: { id: string; propertyName: string; propertyUrl: string | null; status: string; createdAt: string };
    estimates: RentalEstimate[];
  }>(`/api/liff/rental/requests/${encodeURIComponent(requestId)}/estimates`),
  preview: (estimateId: string) => request<{
    estimateId: string;
    requestId: string;
    propertyName: string;
    propertyUrl: string | null;
    roomNumber: string;
    existingApplication: { id: string; status: string } | null;
  }>(`/api/liff/rental/estimates/${encodeURIComponent(estimateId)}/application-preview`),
  apply: (estimateId: string, body: Record<string, unknown>) => request<{
    applicationId: string;
    notificationSent: boolean;
  }>(`/api/liff/rental/estimates/${encodeURIComponent(estimateId)}/applications`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  uploadIdentity: (applicationId: string, body: { data: string; mimeType: string; filename: string }) =>
    request<{ uploaded: boolean }>(`/api/liff/rental/applications/${encodeURIComponent(applicationId)}/identity`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  floorPlanBlob: async (estimateId: string): Promise<{ blobUrl: string; mimeType: string }> => {
    const response = await fetch(url(`/api/liff/rental/estimates/${encodeURIComponent(estimateId)}/floor-plan`), {
      headers: { Authorization: `Bearer ${getIdToken()}` },
    });
    if (!response.ok) {
      let message = '図面を開けませんでした';
      try {
        const parsed = await response.json() as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // keep default message
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    return {
      blobUrl: URL.createObjectURL(blob),
      mimeType: response.headers.get('Content-Type') || blob.type || 'application/octet-stream',
    };
  },
  openFloorPlan: async (estimateId: string): Promise<void> => {
    const response = await fetch(url(`/api/liff/rental/estimates/${encodeURIComponent(estimateId)}/floor-plan`), {
      headers: { Authorization: `Bearer ${getIdToken()}` },
    });
    if (!response.ok) throw new Error('図面を開けませんでした');
    const blobUrl = URL.createObjectURL(await response.blob());
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  },
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}
