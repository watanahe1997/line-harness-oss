import { RENTAL_MONEY_LABELS, RENTAL_CASHBACK_NOTE } from '@line-crm/shared';
import type { RentalEstimate } from '../lib/rental-api.js';
export const yen = (value: unknown) => typeof value === 'number' ? `${value.toLocaleString('ja-JP')}円` : '確認中';
export default function RentalPriceSummary({ estimate }: { estimate: RentalEstimate }) {
  const legacy = estimate.pricingVersion !== 1;
  return <div className="mt-4 space-y-3">
    <div className="grid gap-3 rounded-xl bg-gray-50 p-4">
      <div className="flex justify-between gap-3"><span>月額費用目安</span><strong>{yen(estimate.monthlyTotal)}</strong></div>
      <div className="flex justify-between gap-3"><span>{legacy ? '旧形式の総額目安' : estimate.upfrontTotal == null ? '確認済み初期費用の小計' : '最初に支払う初期費用'}</span><strong className="text-lg text-[#049b43]">{yen(legacy ? estimate.paymentTotal : estimate.upfrontTotal ?? estimate.upfrontSubtotal)}</strong></div>
      {!legacy && <div className="flex justify-between gap-3 text-sm"><span>キャッシュバック後の実質負担</span><strong>{yen(estimate.effectiveTotal)}</strong></div>}
    </div>
    {legacy ? <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">以前の計算形式で提示した見積です。月額費用・前家賃・特典の扱いを含め、支払額は担当者にご確認ください。</p> : <>
      {!!estimate.unknownInitialFields?.length && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">確認中：{estimate.unknownInitialFields.map((key) => RENTAL_MONEY_LABELS[key]).join('、')}。小計にはこれらの費用を含みません。実際の支払額は確認後に変わります。</p>}
      <p className="px-1 text-xs leading-5 text-gray-600">{RENTAL_CASHBACK_NOTE}</p>
    </>}
    <details className="rounded-xl border border-gray-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold">費用の内訳を確認する</summary>
      <dl className="mt-3 divide-y divide-gray-100 text-sm">{Object.entries(RENTAL_MONEY_LABELS).map(([key, label]) => <div key={key} className="flex justify-between gap-3 py-2"><dt className="text-gray-500">{label}</dt><dd>{yen(estimate[key as keyof RentalEstimate])}</dd></div>)}</dl>
      <p className="mt-2 text-xs leading-5 text-gray-500">0円は費用なし、確認中は未確定です。月額費用は初期費用の合計に重ねて加算していません。前家賃には対象期間の家賃・共益費を含みます。退去時の費用・更新料などは注意書きもご確認ください。</p>
    </details>
    {estimate.customerNotes && <p className="whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{estimate.customerNotes}</p>}
  </div>;
}
