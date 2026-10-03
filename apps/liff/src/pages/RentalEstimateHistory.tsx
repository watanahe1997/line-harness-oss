import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';

export default function RentalEstimateHistory() {
  const [data, setData] = useState<Awaited<ReturnType<typeof rentalApi.history>> | null>(null);
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof rentalApi.requests>>>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    setData(null);
    rentalApi.requests().then((value) => { if (active) setRequests(value); }).catch(() => { if (active) setError('依頼状況を読み込めませんでした'); });
    rentalApi.history()
      .then((value) => { if (active) setData(value); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : '見積を読み込めませんでした'); });
    return () => { active = false; };
  }, [reload]);

  return (
    <RentalLayout title="これまでの概算見積">
      <p className="px-1 text-sm leading-6 text-gray-600">
        あなたに提示した概算見積を、新しいご案内から順に表示しています。
      </p>
      {requests.filter((request) => request.presentedCount < request.roomCount).map((request) => <section key={request.id} className={cardClass}><h2 className="font-bold">{request.propertyName}</h2><p className="mt-2 text-sm text-gray-600">{request.statusLabel} ・ {request.roomCount}部屋の依頼 / {request.presentedCount}部屋を提示済み</p><p className="mt-2 text-xs text-gray-500">受付日：{request.createdAt.slice(0, 10)}。{['cancelled', 'out_of_scope'].includes(request.status) ? 'この依頼の見積案内は終了しています。' : '未提示の部屋は確認中、または案内対象外です。準備できた見積はLINEでご案内します。'}</p>{request.presentedCount > 0 && <Link className="mt-3 block text-sm text-[#049b43] underline" to={'/rental/requests/' + request.id}>提示済みの部屋を見る</Link>}</section>)}
      {error && (
        <section className={cardClass} role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" className={`${primaryButtonClass} mt-4`} onClick={() => setReload((value) => value + 1)}>
            もう一度読み込む
          </button>
        </section>
      )}
      {!data && !error && <p className="py-12 text-center text-sm text-gray-500" role="status">見積を読み込み中…</p>}
      {data && data.estimateCount === 0 && (
        <section className={`${cardClass} py-10 text-center`}>
          <h2 className="font-bold">提示済みの概算見積はまだありません</h2>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            見積が届くと、ここでまとめて確認できます。依頼済みの場合は、ご案内までお待ちください。
          </p>
          <Link to="/rental/quote" className={`${primaryButtonClass} mt-6 block`}>新しく見積を依頼する</Link>
        </section>
      )}
      {data && data.estimateCount > 0 && (
        <>
          <p className="px-1 text-xs text-gray-500">全{data.estimateCount}件の概算見積 · {data.requests.length}件の依頼</p>
          {data.requests.map((request) => (
            <section className={cardClass} key={request.id}>
              <h2 className="break-words text-lg font-bold">{request.propertyName}</h2>
              <p className="mt-1 text-xs text-gray-500">依頼日：{request.createdAt.slice(0, 10).replaceAll('-', '/')}</p>
              <div className="mt-4 divide-y divide-gray-100">
                {request.estimates.map((estimate) => (
                  <div key={estimate.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{estimate.roomNumber}号室</h3>
                      <span className="rounded-full bg-[#06C755]/10 px-2.5 py-1 text-xs text-[#049b43]">{estimate.statusLabel}</span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-3">
                      <span className="text-xs text-gray-500">{estimate.pricingVersion === 1 ? estimate.upfrontTotal == null ? '確認済み初期費用の小計' : '最初に支払う初期費用' : '旧形式の総額目安'}</span>
                      <span className="text-lg font-bold text-[#049b43]">
                        {typeof (estimate.pricingVersion === 1 ? estimate.upfrontTotal ?? estimate.upfrontSubtotal : estimate.paymentTotal) === 'number' ? `${Number(estimate.pricingVersion === 1 ? estimate.upfrontTotal ?? estimate.upfrontSubtotal : estimate.paymentTotal).toLocaleString('ja-JP')}円` : '確認中'}
                      </span>
                    </div>
                    {estimate.sentAt && <p className="mt-1 text-xs text-gray-500">提示日：{estimate.sentAt.slice(0, 10).replaceAll('-', '/')}</p>}
                  </div>
                ))}
              </div>
              <Link to={`/rental/requests/${encodeURIComponent(request.id)}`} className={`${primaryButtonClass} mt-4 block text-center`}>
                金額の内訳・図面を見る
              </Link>
            </section>
          ))}
          <p className="px-1 text-xs leading-5 text-gray-500">
            金額はご案内時点の概算です。空室状況・募集条件は変わる場合があります。正式な金額は審査通過後の正式見積で確定します。
          </p>
          <Link to="/rental/quote" className="block rounded-xl border border-[#06C755] px-4 py-3 text-center font-semibold text-[#049b43]">
            別の物件の見積を依頼する
          </Link>
        </>
      )}
    </RentalLayout>
  );
}
