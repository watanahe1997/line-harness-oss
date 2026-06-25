import { useState } from 'react';
import RentalLayout, { Field, cardClass, inputClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';

export default function RentalQuoteRequest() {
  const [form, setForm] = useState({
    propertyName: '', propertyUrl: '', desiredMoveInDate: '', nickname: '',
    hasPets: '', needsParking: '', hasMotorbike: '', needsBicycleParking: '',
  });
  const [rooms, setRooms] = useState(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ requestId: string; estimateCount: number } | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await rentalApi.createQuote({
        ...form,
        roomNumbers: rooms,
        hasPets: form.hasPets === 'yes',
        needsParking: form.needsParking === 'yes',
        hasMotorbike: form.hasMotorbike === 'yes',
        needsBicycleParking: form.needsBicycleParking === 'yes',
      });
      setDone({ requestId: result.requestId, estimateCount: result.estimates.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信できませんでした');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <RentalLayout title="概算見積依頼">
        <section className={`${cardClass} text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#06C755]/10 text-2xl text-[#06C755]">✓</div>
          <h2 className="text-lg font-bold">依頼を受け付けました</h2>
          <p className="mt-3 text-sm leading-6 text-gray-600">{done.estimateCount}部屋分の見積を作成します。準備ができ次第、LINEでお知らせします。</p>
          <p className="mt-4 break-all rounded-lg bg-gray-50 p-3 text-left text-xs text-gray-500">request_id: {done.requestId}</p>
        </section>
      </RentalLayout>
    );
  }

  return (
    <RentalLayout title="概算見積を依頼する">
      <p className="text-sm leading-6 text-gray-600">物件と部屋番号を入力してください。1回で最大5部屋まで依頼できます。</p>
      <form onSubmit={submit} className="space-y-4">
        <section className={`${cardClass} space-y-4`}>
          <Field label="物件名"><input className={inputClass} value={form.propertyName} onChange={(e) => set('propertyName', e.target.value)} placeholder="例：○○マンション" /></Field>
          <Field label="物件URL"><input className={inputClass} type="url" value={form.propertyUrl} onChange={(e) => set('propertyUrl', e.target.value)} placeholder="https://..." /></Field>
          <p className="-mt-2 text-xs text-gray-400">物件名または物件URLのどちらかは必須です。</p>
          <div>
            <div className="mb-1.5 text-sm font-medium text-gray-700">部屋番号 <span className="text-red-500">必須</span></div>
            <div className="space-y-2">
              {rooms.map((room, index) => (
                <div key={index} className="flex gap-2">
                  <input className={inputClass} value={room} onChange={(e) => setRooms((current) => current.map((value, i) => i === index ? e.target.value : value))} placeholder={`部屋番号 ${index + 1}`} required />
                  {rooms.length > 1 && <button type="button" onClick={() => setRooms((current) => current.filter((_, i) => i !== index))} className="rounded-xl border border-gray-200 px-3 text-gray-500">削除</button>}
                </div>
              ))}
            </div>
            {rooms.length < 5 && <button type="button" onClick={() => setRooms((current) => [...current, ''])} className="mt-2 text-sm font-semibold text-[#06C755]">＋ 部屋を追加</button>}
          </div>
          <Field label="入居希望日" required><input className={inputClass} type="date" value={form.desiredMoveInDate} onChange={(e) => set('desiredMoveInDate', e.target.value)} required /></Field>
          <Field label="ニックネーム" required><input className={inputClass} value={form.nickname} onChange={(e) => set('nickname', e.target.value)} required maxLength={100} /></Field>
        </section>
        <section className={`${cardClass} grid gap-4 sm:grid-cols-2`}>
          {[
            ['hasPets', 'ペット有無'], ['needsParking', '駐車場要否'],
            ['hasMotorbike', 'バイク有無'], ['needsBicycleParking', '駐輪場要否'],
          ].map(([key, label]) => (
            <Field key={key} label={label} required>
              <select className={inputClass} value={form[key as keyof typeof form]} onChange={(e) => set(key as keyof typeof form, e.target.value)} required>
                <option value="">選択してください</option><option value="no">なし・不要</option><option value="yes">あり・必要</option>
              </select>
            </Field>
          ))}
        </section>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className={primaryButtonClass} disabled={submitting}>{submitting ? '送信中…' : '概算見積を依頼する'}</button>
      </form>
    </RentalLayout>
  );
}
