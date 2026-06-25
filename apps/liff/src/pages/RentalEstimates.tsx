import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi, type RentalEstimate } from '../lib/rental-api.js';

const moneyRows: Array<[keyof RentalEstimate, string]> = [
  ['rent', '家賃'], ['managementFee', '共益費・管理費'], ['deposit', '敷金'], ['keyMoney', '礼金'],
  ['advanceRent', '前家賃'], ['proratedRent', '日割り家賃'], ['fireInsurance', '火災保険'],
  ['guaranteeCompanyFee', '保証会社費用'], ['keyExchangeFee', '鍵交換費'], ['cleaningFee', 'クリーニング費'],
  ['otherInitialCost', 'その他初期費用'], ['brokerageFee', '仲介手数料'],
  ['brokerageDiscount', '仲介手数料割引'], ['cashback', 'キャッシュバック'],
];

const yen = (value: unknown) => typeof value === 'number' ? `${value.toLocaleString('ja-JP')}円` : '確認中';

export default function RentalEstimates() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof rentalApi.estimates>> | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { rentalApi.estimates(requestId).then(setData).catch((err) => setError(err.message)); }, [requestId]);

  async function openFloorPlan(id: string) {
    setOpening(id);
    try { await rentalApi.openFloorPlan(id); } catch (err) { setError(err instanceof Error ? err.message : '図面を開けませんでした'); }
    finally { setOpening(null); }
  }

  return (
    <RentalLayout title="概算見積一覧">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-12 text-center text-sm text-gray-500">読み込み中…</p>}
      {data && <>
        <section className={cardClass}>
          <h2 className="font-bold">{data.request.propertyName}</h2>
          {data.request.propertyUrl && <a className="mt-2 block break-all text-sm text-[#06C755] underline" href={data.request.propertyUrl} target="_blank" rel="noreferrer">物件ページを開く</a>}
        </section>
        {data.estimates.map((estimate) => (
          <section key={estimate.id} className={cardClass}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold">{estimate.roomNumber}号室</h3>
              <span className="rounded-full bg-[#06C755]/10 px-2.5 py-1 text-xs font-semibold text-[#049b43]">{estimate.statusLabel}</span>
            </div>
            <dl className="mt-4 divide-y divide-gray-100 text-sm">
              {moneyRows.map(([key, label]) => <div key={String(key)} className="flex justify-between gap-4 py-2"><dt className="text-gray-500">{label}</dt><dd className="font-medium">{yen(estimate[key])}</dd></div>)}
            </dl>
            <div className="mt-4 flex items-end justify-between rounded-xl bg-gray-50 p-4">
              <span className="text-sm font-semibold">支払総額目安</span><span className="text-xl font-bold text-[#06C755]">{yen(estimate.paymentTotal)}</span>
            </div>
            {estimate.customerNotes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{estimate.customerNotes}</p>}
            <div className="mt-4 space-y-2">
              {estimate.hasFloorPlan && <button type="button" className="w-full rounded-xl border border-gray-200 px-4 py-3 font-semibold" onClick={() => openFloorPlan(estimate.id)} disabled={opening === estimate.id}>{opening === estimate.id ? '図面を開いています…' : `図面を見る${estimate.floorPlanName ? `（${estimate.floorPlanName}）` : ''}`}</button>}
              {['quote_presented', 'application_requested'].includes(estimate.status) && <button className={primaryButtonClass} onClick={() => navigate(`/rental/estimates/${estimate.id}/confirm`)}>{estimate.roomNumber}号室で審査申込へ進む</button>}
            </div>
            <p className="mt-3 break-all text-[10px] text-gray-300">estimate_id: {estimate.id}</p>
          </section>
        ))}
        <p className="px-2 text-xs leading-5 text-gray-500">概算見積のため、正式な金額は審査通過後の正式見積で確定します。</p>
      </>}
    </RentalLayout>
  );
}
