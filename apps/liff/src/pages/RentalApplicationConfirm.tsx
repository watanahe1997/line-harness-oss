import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';

export default function RentalApplicationConfirm() {
  const { estimateId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof rentalApi.preview>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { rentalApi.preview(estimateId).then(setData).catch((err) => setError(err.message)); }, [estimateId]);
  return (
    <RentalLayout title="申込対象の確認">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-12 text-center text-sm text-gray-500">読み込み中…</p>}
      {data && <>
        <section className={cardClass}>
          <p className="text-xs font-semibold text-gray-400">申込対象</p>
          <h2 className="mt-2 text-lg font-bold">{data.propertyName}</h2>
          <p className="mt-1 text-xl font-bold text-[#06C755]">{data.roomNumber}号室</p>
          <p className="mt-4 text-sm leading-6 text-gray-600">上記の物件・部屋番号で審査申込へ進みます。内容に間違いがなければ、下のボタンを押してください。</p>
        </section>
        {data.existingApplication ? (
          <section className={`${cardClass} text-sm text-gray-600`}>この部屋は申込済みです。<br />application_id: {data.existingApplication.id}</section>
        ) : <button className={primaryButtonClass} onClick={() => navigate(`/rental/estimates/${estimateId}/apply`)}>この部屋で審査申込を希望する</button>}
      </>}
    </RentalLayout>
  );
}
