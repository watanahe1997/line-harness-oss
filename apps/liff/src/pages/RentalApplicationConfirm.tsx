import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';

type PreviewData = Awaited<ReturnType<typeof rentalApi.preview>>;

export default function RentalApplicationConfirm() {
  const { estimateId = '' } = useParams();
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    setData(null);
    setError('');
    setDone(false);
    rentalApi.preview(estimateId)
      .then((value) => {
        if (mounted) setData(value);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : '読み込みに失敗しました');
      });
    return () => {
      mounted = false;
    };
  }, [estimateId]);

  async function requestApplication() {
    setSubmitting(true);
    setError('');
    try {
      await rentalApi.requestApplication(estimateId);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '審査申込希望を送信できませんでした');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RentalLayout title="審査申込希望の確認">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-12 text-center text-sm text-gray-500">読み込み中…</p>}

      {data && done && (
        <section className={cardClass}>
          <p className="text-xs font-semibold text-[#06C755]">受付完了</p>
          <h2 className="mt-2 text-lg font-bold">審査申込の希望を受け付けました</h2>
          <p className="mt-4 text-sm leading-6 text-gray-600">
            担当者が内容を確認し、管理会社ごとの手続きに合わせてLINEで個別にご案内します。
          </p>
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-500">
            この時点では、管理会社へ申込書が自動送信されるわけではありません。今後の必要書類や入力方法は担当者からの案内をお待ちください。
          </p>
        </section>
      )}

      {data && !done && (
        <>
          <section className={cardClass}>
            <p className="text-xs font-semibold text-gray-400">申込希望の対象</p>
            <h2 className="mt-2 text-lg font-bold">{data.propertyName}</h2>
            <p className="mt-1 text-xl font-bold text-[#06C755]">{data.roomNumber}号室</p>
            {data.propertyUrl && (
              <a
                className="mt-3 block break-all text-sm text-[#06C755] underline"
                href={data.propertyUrl}
                target="_blank"
                rel="noreferrer"
              >
                物件ページを開く
              </a>
            )}
            <p className="mt-4 text-sm leading-6 text-gray-600">
              この部屋で審査申込を希望する場合は、下のボタンを押してください。
              押すと担当者に通知され、今後の手続きはLINEで個別にご案内します。
            </p>
          </section>

          {data.existingApplication ? (
            <section className={`${cardClass} text-sm leading-6 text-gray-600`}>
              この部屋はすでに審査申込情報を受付済みです。担当者からの案内をお待ちください。
              <br />
              application_id: {data.existingApplication.id}
            </section>
          ) : (
            <button className={primaryButtonClass} onClick={requestApplication} disabled={submitting}>
              {submitting ? '送信中…' : 'この部屋で審査申込を希望する'}
            </button>
          )}
        </>
      )}
    </RentalLayout>
  );
}
