import RentalPriceSummary from '../components/RentalPriceSummary.js';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RentalLayout, { cardClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi, type RentalEstimate } from '../lib/rental-api.js';

type FloorPlanPreview = {
  estimateId: string;
  blobUrl: string;
  mimeType: string;
  name: string;
};

export default function RentalEstimates() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof rentalApi.estimates>> | null>(null);
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<Record<string, RentalEstimate[]>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlanPreview | null>(null);
  const [expandedFloorPlan, setExpandedFloorPlan] = useState<FloorPlanPreview | null>(null);

  useEffect(() => {
    rentalApi.estimates(requestId).then(setData).catch((err) => setError(err.message));
  }, [requestId]);

  useEffect(() => () => {
    if (floorPlan?.blobUrl) URL.revokeObjectURL(floorPlan.blobUrl);
  }, [floorPlan?.blobUrl]);

  async function openFloorPlan(estimate: RentalEstimate) {
    setOpening(estimate.id);
    setError('');
    try {
      const result = await rentalApi.floorPlanBlob(estimate.id);
      const preview = {
        estimateId: estimate.id,
        blobUrl: result.blobUrl,
        mimeType: result.mimeType,
        name: estimate.floorPlanName || 'floor-plan',
      };
      setFloorPlan(preview);
      setExpandedFloorPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '図面を開けませんでした');
    } finally {
      setOpening(null);
    }
  }

  return (
    <RentalLayout title="概算見積一覧">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-12 text-center text-sm text-gray-500">読み込み中…</p>}

      {data && (
        <>
          <section className={cardClass}>
            <h2 className="font-bold">{data.request.propertyName}</h2>
            {data.request.propertyUrl && (
              <a
                className="mt-2 block break-all text-sm text-[#06C755] underline"
                href={data.request.propertyUrl}
                target="_blank"
                rel="noreferrer"
              >
                物件ページを開く
              </a>
            )}
          </section>

          {data.estimates.length === 0 && <section className={cardClass}><h3 className="font-bold">見積を準備しています</h3><p className="mt-2 text-sm text-gray-600">準備でき次第、LINEでご案内します。</p></section>}
          {data.estimates.map((estimate) => (
            <section key={estimate.id} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-bold">{estimate.roomNumber}号室</h3>
                <span className="rounded-full bg-[#06C755]/10 px-2.5 py-1 text-xs font-semibold text-[#049b43]">
                  {estimate.statusLabel}
                </span>
              </div>

              <RentalPriceSummary estimate={estimate} />
              <div className="mt-4 space-y-2">
                {estimate.hasFloorPlan && (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 font-semibold"
                    onClick={() => openFloorPlan(estimate)}
                    disabled={opening === estimate.id}
                  >
                    {opening === estimate.id
                      ? '図面を読み込み中…'
                      : `図面を見る${estimate.floorPlanName ? `（${estimate.floorPlanName}）` : ''}`}
                  </button>
                )}

                {floorPlan?.estimateId === estimate.id && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">図面プレビュー</p>
                        <p className="mt-1 text-xs text-gray-500">画像をタップすると拡大表示できます。</p>
                      </div>
                      <button
                        type="button"
                        className="text-sm font-semibold text-gray-500"
                        onClick={() => {
                          setExpandedFloorPlan(null);
                          setFloorPlan(null);
                        }}
                      >
                        閉じる
                      </button>
                    </div>

                    {floorPlan.mimeType.startsWith('image/') ? (
                      <button
                        type="button"
                        className="block w-full overflow-hidden rounded-lg bg-white"
                        onClick={() => setExpandedFloorPlan(floorPlan)}
                        aria-label="図面を拡大表示する"
                      >
                        <img
                          src={floorPlan.blobUrl}
                          alt="図面"
                          className="max-h-72 w-full object-contain"
                        />
                      </button>
                    ) : (
                      <div className="rounded-lg bg-white p-4 text-sm text-gray-600">
                        この形式はLINE内で直接表示できない場合があります。画像形式の図面を添付してください。
                      </div>
                    )}
                  </div>
                )}

                {['quote_presented', 'application_requested'].includes(estimate.status) && (
                  <button
                    className={primaryButtonClass}
                    disabled={estimate.status === 'application_requested'}
                    onClick={() => navigate(`/rental/estimates/${estimate.id}/confirm`)}
                  >
                    {estimate.status === 'application_requested' ? '審査申込希望を受付済み' : 'この部屋で審査申込を希望する'}
                  </button>
                )}
              </div>

              {estimate.sentAt && <p className="mt-3 text-xs text-gray-500">提示日：{estimate.sentAt.slice(0, 10)} ・ 内容版 {estimate.revision}</p>}
              <button type="button" className="mt-3 text-xs text-[#049b43] underline" onClick={async () => {
                try { setVersions((current) => ({ ...current, [estimate.id]: [] })); const values = await rentalApi.versions(estimate.id); setVersions((current) => ({ ...current, [estimate.id]: values })); }
                catch (error) { setError(error instanceof Error ? error.message : '履歴を読み込めませんでした'); }
              }}>以前の提示内容を見る</button>
              {versions[estimate.id] && <div className="mt-3 space-y-3">{versions[estimate.id].length <= 1 ? <p className="text-xs text-gray-500">以前の提示内容はありません。</p> : versions[estimate.id].slice(1).map((version) => <details key={version.revision} className="rounded-xl border p-3"><summary className="text-sm">{version.sentAt?.slice(0, 10)} の提示内容（版 {version.revision}）</summary><RentalPriceSummary estimate={version} />{version.hasFloorPlan && <button type="button" className="mt-3 text-sm underline" onClick={async () => { try { const result = await rentalApi.floorPlanBlob(estimate.id, version.revision); setFloorPlan({ estimateId: estimate.id, ...result, name: version.floorPlanName || '図面' }); } catch { setError('図面を開けませんでした'); } }}>この提示時の図面を見る</button>}</details>)}</div>}
            </section>
          ))}

          <p className="px-2 text-xs leading-5 text-gray-500">
            概算見積のため、正式な金額は審査通過後の正式見積で確定します。
          </p>
        </>
      )}

      {expandedFloorPlan && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 text-white">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{expandedFloorPlan.name}</p>
              <p className="text-xs text-white/70">ピンチ操作で拡大・縮小できます。</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold"
              onClick={() => setExpandedFloorPlan(null)}
            >
              閉じる
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-black">
            <img
              src={expandedFloorPlan.blobUrl}
              alt="拡大した図面"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </RentalLayout>
  );
}
