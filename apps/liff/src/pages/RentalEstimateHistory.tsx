import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';

export default function RentalEstimateHistory() {
  const [data, setData] = useState<Awaited<ReturnType<typeof rentalApi.history>> | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    setData(null);
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
                      <span className="text-xs text-gray-500">支払総額目安</span>
                      <span className="text-lg font-bold text-[#049b43]">
                        {typeof estimate.paymentTotal === 'number' ? `${estimate.paymentTotal.toLocaleString('ja-JP')}円` : '確認中'}
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
