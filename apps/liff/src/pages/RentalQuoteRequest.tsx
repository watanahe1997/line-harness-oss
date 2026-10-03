import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RentalLayout, { Field, cardClass, inputClass, primaryButtonClass } from '../components/RentalLayout.js';
import { rentalApi } from '../lib/rental-api.js';
import { getLineUserId } from '../lib/liff-auth.js';

const empty = { propertyName: '', propertyUrl: '', propertyAddress: '', dateKind: 'undecided', desiredMoveInDate: '', nickname: '',
  hasPets: '', needsParking: '', hasMotorbike: '', needsBicycleParking: '', petsDetail: '', parkingDetail: '', motorbikeDetail: '', bicycleDetail: '' };
const conditions = [['hasPets', 'ペット', 'petsDetail', '種類・頭数（例：猫1匹）'], ['needsParking', '駐車場', 'parkingDetail', '台数（例：普通車1台）'],
  ['hasMotorbike', 'バイク', 'motorbikeDetail', '台数・排気量（例：1台、125cc）'], ['needsBicycleParking', '駐輪場', 'bicycleDetail', '台数（例：自転車1台）']] as const;
type Draft = { form: typeof empty; rooms: string[]; roomUnknown: boolean; submissionKey: string; savedAt: number };
function storageKey() { return 'rental-quote-draft:' + getLineUserId(); }
function recover(): Draft {
  try { const data = JSON.parse(localStorage.getItem(storageKey()) || 'null');
    if (data && data.savedAt > Date.now() - 7 * 86400000 && Array.isArray(data.rooms) && typeof data.submissionKey === 'string')
      return { ...data, form: { ...empty, ...data.form } };
  } catch { /* Storage may be unavailable in LINE's browser. */ }
  return { form: empty, rooms: [''], roomUnknown: false, submissionKey: crypto.randomUUID(), savedAt: Date.now() };
}
export default function RentalQuoteRequest() {
  const [draft, setDraft] = useState(recover);
  const { form, rooms, roomUnknown } = draft;
  const [confirming, setConfirming] = useState(false), [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ requestId: string; notificationSent: boolean } | null>(null);
  const set = (key: keyof typeof form, value: string) => setDraft((current) => ({ ...current, form: { ...current.form, [key]: value } }));
  useEffect(() => { if (!done) { try { localStorage.setItem(storageKey(), JSON.stringify({ ...draft, savedAt: Date.now() })); } catch { /* Optional recovery. */ } } }, [draft, done]);
  const date = form.dateKind === 'undecided' ? '未定' : form.dateKind === 'month' ? form.desiredMoveInDate + '頃' : form.desiredMoveInDate;
  const selectedRooms = roomUnknown ? ['部屋番号未確認'] : [...new Set(rooms.map((value) => value.normalize('NFKC').replace(/\s*号室$/, '').trim()))];
  const detail = conditions.map(([key, label, detailKey]) => label + '：' + (form[key] === 'yes' ? 'あり・必要 / ' + (form[detailKey] || '詳細未確認') : 'なし・不要')).join('\n');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!form.propertyUrl && (!form.propertyName.trim() || !form.propertyAddress.trim())) { setError('物件URL、または物件名と所在地を入力してください'); return; }
    if (!confirming) { setConfirming(true); return; }
    setSubmitting(true);
    try {
      const result = await rentalApi.createQuote({ ...form, desiredMoveInDate: date, roomNumbers: selectedRooms, conditionDetails: detail,
        submissionKey: draft.submissionKey, hasPets: form.hasPets === 'yes', needsParking: form.needsParking === 'yes',
        hasMotorbike: form.hasMotorbike === 'yes', needsBicycleParking: form.needsBicycleParking === 'yes' });
      setDone({ requestId: result.requestId, notificationSent: result.notificationSent });
      try { localStorage.removeItem(storageKey()); } catch { /* Optional recovery. */ }
    } catch (err) { setError(err instanceof Error ? err.message : '送信できませんでした。同じ内容で再試行してください。'); }
    finally { setSubmitting(false); }
  }
  if (done) return <RentalLayout title="概算見積依頼"><section className={cardClass + ' text-center'}>
    <div className="mb-3 text-3xl text-[#06C755]">✓</div><h2 className="text-lg font-bold">依頼を受け付けました</h2>
    <p className="mt-3 font-semibold break-words">{form.propertyName || form.propertyUrl}</p><p className="mt-2 text-sm">対象：{selectedRooms.join('・')}</p>
    <p className="mt-3 text-sm leading-6 text-gray-600">準備でき次第、LINEでご案内します。再入力は不要です。</p>
    {!done.notificationSent && <p className="mt-3 text-xs text-amber-800">依頼は保存済みです。LINEの受付通知が届かなくても、下のボタンで受付状況を確認できます。</p>}
    <Link className={primaryButtonClass + ' mt-5 block'} to="/rental/estimates">依頼状況・これまでの見積を見る</Link>
  </section></RentalLayout>;
  return <RentalLayout title={confirming ? '依頼内容を確認する' : '概算見積を依頼する'}>
    <p className="text-sm leading-6 text-gray-600">{confirming ? '内容を確認して送信してください。' : '1回で最大5部屋まで依頼できます。入力内容はこの端末に7日間保存されます。'}</p>
    <form onSubmit={submit} className="space-y-4">
      {confirming ? <section className={cardClass + ' space-y-3 text-sm'}><p className="break-words font-bold">{form.propertyName || form.propertyUrl}</p>
        {form.propertyUrl && <p className="break-all text-xs">{form.propertyUrl}</p>}<p>{form.propertyAddress}</p><p>対象：{selectedRooms.join('・')}</p><p>入居希望：{date}</p><p>ニックネーム：{form.nickname}</p><p className="whitespace-pre-wrap leading-6">{detail}</p>
        <button type="button" disabled={submitting} onClick={() => setConfirming(false)} className="text-[#049b43] underline">入力内容を修正する</button>
      </section> : <>
        <section className={cardClass + ' space-y-4'}>
          <Field label="物件ページのURL（おすすめ）"><input className={inputClass} type="url" value={form.propertyUrl} onChange={(e) => set('propertyUrl', e.target.value)} placeholder="SUUMO・HOME'Sなどの物件URL" maxLength={2000} /></Field>
          <Field label="物件名" required={!form.propertyUrl}><input className={inputClass} value={form.propertyName} onChange={(e) => set('propertyName', e.target.value)} placeholder="例：○○マンション" required={!form.propertyUrl} maxLength={300} /></Field>
          {!form.propertyUrl && <Field label="物件の所在地" required><input className={inputClass} value={form.propertyAddress} onChange={(e) => set('propertyAddress', e.target.value)} placeholder="例：大阪市北区○○町（同名物件の取り違え防止）" required maxLength={300} /></Field>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={roomUnknown} onChange={(e) => setDraft({ ...draft, roomUnknown: e.target.checked })} />部屋番号が分からない</label>
          {!roomUnknown && <div className="space-y-2">{rooms.map((room, index) => <div key={index} className="flex gap-2"><input className={inputClass} value={room} onChange={(e) => setDraft({ ...draft, rooms: rooms.map((value, i) => i === index ? e.target.value : value) })} placeholder="部屋番号（例：101）" maxLength={50} required />{rooms.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, rooms: rooms.filter((_, i) => i !== index) })} className="px-3">削除</button>}</div>)}{rooms.length < 5 && <button type="button" onClick={() => setDraft({ ...draft, rooms: [...rooms, ''] })} className="text-sm text-[#049b43]">＋ 部屋を追加</button>}</div>}
          <Field label="入居希望"><select className={inputClass} value={form.dateKind} onChange={(e) => { setDraft({ ...draft, form: { ...form, dateKind: e.target.value, desiredMoveInDate: '' } }); }}><option value="undecided">まだ未定</option><option value="month">○月頃</option><option value="date">日付を指定</option></select></Field>
          {form.dateKind !== 'undecided' && <input aria-label="入居希望の時期" className={inputClass} type={form.dateKind === 'month' ? 'month' : 'date'} value={form.desiredMoveInDate} onChange={(e) => set('desiredMoveInDate', e.target.value)} required />}
          <Field label="ニックネーム" required><input className={inputClass} value={form.nickname} onChange={(e) => set('nickname', e.target.value)} required maxLength={100} /></Field>
        </section>
        <section className={cardClass + ' space-y-4'}>{conditions.map(([key, label, detailKey, placeholder]) => <div key={key}><Field label={label} required><select className={inputClass} value={form[key]} onChange={(e) => set(key, e.target.value)} required><option value="">選択してください</option><option value="no">なし・不要</option><option value="yes">あり・必要</option></select></Field>{form[key] === 'yes' && <input aria-label={label + 'の詳細'} className={inputClass + ' mt-2'} value={form[detailKey]} onChange={(e) => set(detailKey, e.target.value)} placeholder={placeholder + '（分かる範囲で）'} maxLength={200} />}</div>)}</section>
        <button type="button" className="text-xs text-gray-500 underline" onClick={() => { if (window.confirm('保存した入力内容を消しますか？')) { setDraft({ form: empty, rooms: [''], roomUnknown: false, submissionKey: crypto.randomUUID(), savedAt: Date.now() }); } }}>入力内容をクリア</button>
      </>}
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700"><p>{error}</p><Link className="mt-2 block underline" to="/rental/estimates">受付状況を確認する</Link></div>}
      <button className={primaryButtonClass} disabled={submitting}>{submitting ? '送信中…' : confirming ? 'この内容で見積を依頼する' : '内容を確認する'}</button>
    </form>
  </RentalLayout>;
}
