'use client'

import { rentalPricing, RENTAL_MONEY_LABELS, RENTAL_CASHBACK_NOTE, type RentalMoneyKey } from '@line-crm/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchApi, fetchApiBlob } from '@/lib/api'
import RentalRichMenu from '@/components/rental-rich-menu'

type ApiResponse<T> = { success: boolean; data: T; error?: string }

type Estimate = {
  id: string; requestId: string; roomNumber: string; status: string; statusLabel: string
  rent: number | null; managementFee: number | null; deposit: number | null; keyMoney: number | null
  advanceRent: number | null; proratedRent: number | null; fireInsurance: number | null
  guaranteeCompanyFee: number | null; keyExchangeFee: number | null; cleaningFee: number | null
  otherInitialCost: number | null; brokerageFee: number | null; brokerageDiscount: number | null
  requestedQuote?: Estimate | null;
  notificationStatus?: 'pending' | 'failed' | 'sent' | null;
  revision: number; pricingVersion: number; publishedRevision: number | null; monthlyOtherCost: number | null;
  cashback: number | null; paymentTotal: number | null; managerMemo: string | null
  customerNotes: string | null; hasFloorPlan: boolean; floorPlanName: string | null; sentAt: string | null
}

type QuoteRequest = {
  id: string; friend_id: string; line_user_id: string; display_name: string | null
  property_name: string; property_url: string | null; desired_move_in_date: string; nickname: string
  property_address: string | null; condition_details: string | null;
  has_pets: number; needs_parking: number; has_motorbike: number; needs_bicycle_parking: number
  status: string; created_at: string; estimates: Estimate[]
}

type ApplicationListItem = {
  id: string; requestId: string; estimateId: string; status: string; statusLabel: string
  propertyName: string; roomNumber: string; lineUserId: string; displayName: string | null
  createdAt: string; anonymizedAt: string | null
}

const estimateStatusOptions = [
  ['quote_pending', '見積作成待ち'], ['quote_in_progress', '見積作成中'],
  ['quote_presented', '見積提示済み'], ['out_of_scope', '対象外・確認不可'],
  ['application_requested', '審査申込希望'], ['application_submitted', '審査申込入力済み'],
  ['individual_followup', '個別対応中'], ['contracted', '成約'], ['cancelled', 'キャンセル'],
]

const applicationStatusOptions = [
  ['application_submitted', '審査申込入力済み'], ['reviewing', '内容確認中'],
  ['additional_information', '追加確認中'], ['preparing_submission', '管理会社提出準備中'],
  ['submitted_to_partner', '管理会社・保証会社へ提出済み'], ['screening', '審査中'],
  ['approved', '審査承認'], ['rejected', '審査否認'], ['formal_estimate_presented', '正式見積提示済み'],
  ['contract_in_progress', '契約手続き中'], ['contracted', '成約'], ['cancelled', 'キャンセル'],
]

const moneyFields = Object.entries(RENTAL_MONEY_LABELS) as Array<[RentalMoneyKey, string]>
const yen = (value: number | null) => value == null ? '確認中' : value.toLocaleString('ja-JP') + '円'

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full bg-[#06C755]/10 px-2.5 py-1 text-xs font-semibold text-[#049b43]">{children}</span>
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function QuotePreview({ estimate }: { estimate: Estimate }) {
  const price = rentalPricing(estimate)
  const legacy = estimate.pricingVersion !== 1
  return <div className="rounded-xl border p-4"><h3 className="font-bold">{estimate.roomNumber}号室</h3>
    <dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt>月額費用目安</dt><dd>{yen(price.monthlyTotal)}</dd></div><div className="flex justify-between"><dt>{legacy ? '旧形式の総額目安' : price.upfrontTotal == null ? '確認済み初期費用の小計' : '最初に支払う初期費用'}</dt><dd className="font-bold">{yen(legacy ? estimate.paymentTotal : price.upfrontTotal ?? price.upfrontSubtotal)}</dd></div>{!legacy && <div className="flex justify-between"><dt>キャッシュバック後の実質負担</dt><dd>{yen(price.effectiveTotal)}</dd></div>}</dl>
    {!legacy && !!price.unknownInitialFields.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs">確認中：{price.unknownInitialFields.map((key) => RENTAL_MONEY_LABELS[key]).join('、')}。小計には含みません。</p>}
    <p className="mt-3 text-xs leading-5">{legacy ? '以前の計算形式で提示した見積です。月額費用・前家賃・特典の扱いを含め、支払額は担当者にご確認ください。' : RENTAL_CASHBACK_NOTE}</p>
    <details className="mt-3"><summary className="text-sm">内訳を見る</summary><dl className="mt-2 space-y-1 text-xs">{moneyFields.map(([key, label]) => <div key={key} className="flex justify-between"><dt>{label}</dt><dd>{yen(estimate[key])}</dd></div>)}</dl></details>
    {estimate.customerNotes && <p className="mt-3 whitespace-pre-wrap text-sm">{estimate.customerNotes}</p>}
    <p className="mt-3 text-xs text-gray-500">図面：{estimate.floorPlanName || '添付なし'}。概算のため、正式な費用・空室状況は確認が必要です。</p>
  </div>
}
function estimateDraft(estimate: Estimate): Record<string, string> {
  return Object.fromEntries([...moneyFields.map(([key]) => [key, estimate[key] == null ? '' : String(estimate[key])]),
    ['roomNumber', estimate.roomNumber], ['status', estimate.status], ['managerMemo', estimate.managerMemo ?? ''], ['customerNotes', estimate.customerNotes ?? '']])
}
function EstimateEditor({ estimate, onChanged, onDirty }: { estimate: Estimate; onChanged: () => void; onDirty: (id: string, dirty: boolean) => void }) {
  const [baseline, setBaseline] = useState(estimate)
  const [draft, setDraft] = useState<Record<string, string>>(() => estimateDraft(estimate))
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [preview, setPreview] = useState<Estimate | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(estimateDraft(baseline))
  useEffect(() => { if (!dirty && (estimate.revision > baseline.revision || (estimate.revision === baseline.revision && JSON.stringify(estimateDraft(estimate)) !== JSON.stringify(estimateDraft(baseline))))) { setBaseline(estimate); setDraft(estimateDraft(estimate)) } }, [estimate, baseline, dirty])
  const price = rentalPricing(Object.fromEntries(moneyFields.map(([key]) => [key, draft[key] === '' ? null : Number(draft[key])])))
  useEffect(() => { onDirty(estimate.id, dirty); return () => onDirty(estimate.id, false) }, [dirty, estimate.id, onDirty])
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  async function save(showPreview = false) {
    if (!dirty) { if (showPreview) { setError(''); setPreview(baseline) } return }
    setBusy('save'); setError('')
    try {
      const response = await fetchApi<ApiResponse<Estimate>>('/api/rental/estimates/' + estimate.id, { method: 'PATCH', body: JSON.stringify({ ...draft, expectedRevision: baseline.revision }) })
      setBaseline(response.data); setDraft(estimateDraft(response.data))
      if (showPreview) setPreview(response.data); else onChanged()
    } catch { setError('保存できませんでした。別の編集・送信がないか再読み込みして確認してください。') } finally { setBusy('') }
  }
  async function upload(file: File) {
    if (dirty) { setError('入力中の内容を先に保存してから図面を添付してください'); return }
    setBusy('upload'); setError('')
    try { await fetchApi('/api/rental/estimates/' + estimate.id + '/floor-plan', { method: 'POST', body: JSON.stringify({ data: await toDataUrl(file), mimeType: file.type, filename: file.name, expectedRevision: baseline.revision }) }); onChanged() }
    catch { setError('図面を添付できませんでした。ファイルと保存状態を確認してください。') } finally { setBusy('') }
  }
  async function send() {
    if (!preview) return
    setBusy('send'); setError('')
    try {
      const response = await fetchApi<ApiResponse<{ notificationSent: boolean }>>('/api/rental/estimates/' + estimate.id + '/send', { method: 'POST', body: JSON.stringify({ expectedRevision: preview.revision }) })
      if (!response.data.notificationSent) { setError('見積は公開済みですがLINE通知が未完了です。この画面から再試行してください。'); return }
      setPreview(null); onChanged()
    } catch { setError('送信できませんでした。編集の競合・月間配信上限・LINE設定を確認してください。') } finally { setBusy('') }
  }
  return <div className="rounded-xl border border-gray-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{estimate.roomNumber}号室</h3><Badge>{dirty ? '未保存の変更あり' : estimate.statusLabel}</Badge></div>
    {estimate.requestedQuote && <details className="mt-3 rounded-lg bg-green-50 p-3"><summary className="text-sm font-semibold">お客さんが申込を希望した時点の見積を見る</summary><QuotePreview estimate={estimate.requestedQuote} /></details>}
    {estimate.sentAt && <p className="mt-2 text-xs text-gray-500">提示済み。編集を保存しても、お客さんには再送まで以前の提示内容を表示します。</p>}
    {estimate.notificationStatus && estimate.notificationStatus !== 'sent' && <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">見積は公開済みですが、LINE通知が未完了です。内容を変えずに送信プレビューから再試行できます。</p>}
    <fieldset disabled={Boolean(busy) || Boolean(preview)}>
      <label className="mt-3 block text-xs">部屋番号（未確認の場合は判明後に更新）<input value={draft.roomNumber} maxLength={50} onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
      <p className="mt-4 text-xs text-gray-500">空欄＝確認中、0＝費用なし。前家賃・日割り家賃には対象期間の共益費を含めてください。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{moneyFields.map(([key, label]) => <label key={key} className="text-xs text-gray-500">{label}<input type="number" min="0" step="1" placeholder="確認中" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" /></label>)}</div>
      <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">月額 {yen(price.monthlyTotal)} ／ {price.upfrontTotal == null ? '初期費用小計' : '初期支払額'} {yen(price.upfrontTotal ?? price.upfrontSubtotal)} ／ 実質 {yen(price.effectiveTotal)}</div>
      <label className="mt-3 block text-xs">ステータス<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{estimateStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="mt-3 block text-xs">顧客向け注意書き（前家賃の対象月・その他費用の内訳・退去時費用・特典条件）<textarea value={draft.customerNotes} onChange={(e) => setDraft({ ...draft, customerNotes: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} maxLength={3000} /></label>
      <label className="mt-3 block text-xs">管理者メモ（顧客には非表示）<textarea value={draft.managerMemo} onChange={(e) => setDraft({ ...draft, managerMemo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} maxLength={5000} /></label>
    </fieldset>
    <div className="mt-4 flex flex-wrap gap-2">
      <button onClick={() => save()} disabled={Boolean(busy) || Boolean(preview)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">保存</button>
      <label className="cursor-pointer rounded-lg border px-4 py-2 text-sm">図面を添付<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={Boolean(busy) || Boolean(preview)} onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file) }} /></label>
      {estimate.hasFloorPlan && <button onClick={async () => openBlob(await fetchApiBlob('/api/rental/estimates/' + estimate.id + '/floor-plan'))} className="rounded-lg border px-4 py-2 text-sm">図面を確認</button>}
      <button onClick={() => save(true)} disabled={Boolean(busy) || Boolean(preview) || price.invalidDiscount || price.invalidCashback} className="rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white">保存して送信プレビュー</button>
    </div>
    {(price.invalidDiscount || price.invalidCashback) && <p className="mt-3 text-sm text-red-600">割引・キャッシュバックが対象の費用を超えています。</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {preview && <div role="dialog" aria-modal="true" aria-label="見積送信プレビュー" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5"><h2 className="mb-3 text-lg font-bold">お客さんへの提示内容を確認</h2><QuotePreview estimate={preview} /><p className="mt-3 text-xs text-gray-500">管理者メモは表示されません。下の送信ボタンで見積を公開し、LINEに通知します。</p>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<div className="mt-4 flex gap-3"><button disabled={Boolean(busy)} onClick={() => { setPreview(null); onChanged() }} className="rounded-lg border px-4 py-2">閉じる</button><button disabled={Boolean(busy)} onClick={send} className="rounded-lg bg-[#06C755] px-4 py-2 text-white">{busy === 'send' ? '送信中…' : 'この内容をLINEで送信'}</button></div></section></div>}
  </div>
}

function QuoteRequestsTab() {
  const [items, setItems] = useState<QuoteRequest[]>([])
  const dirtyIds = useRef(new Set<string>())
  const onDirty = useCallback((id: string, dirty: boolean) => { if (dirty) dirtyIds.current.add(id); else dirtyIds.current.delete(id) }, [])
  const [batchPreview, setBatchPreview] = useState<QuoteRequest | null>(null)
  const [sendingBatch, setSendingBatch] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const query = new URLSearchParams(); if (search) query.set('search', search); if (status) query.set('status', status)
      const response = await fetchApi<ApiResponse<QuoteRequest[]>>(`/api/rental/requests?${query}`)
      setItems(response.data)
    } catch { setError('見積依頼を読み込めませんでした') } finally { setLoading(false) }
  }, [search, status])
  useEffect(() => { load() }, [load])

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row">
      <input value={search} onChange={(e) => { if (dirtyIds.current.size) { setError('未保存の変更があります。保存してから検索条件を変えてください。'); return } setSearch(e.target.value) }} placeholder="request_id・LINEユーザー・物件・部屋番号" className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <select value={status} onChange={(e) => { if (dirtyIds.current.size) { setError('未保存の変更があります。保存してから表示条件を変えてください。'); return } setStatus(e.target.value) }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">すべての状態</option>{estimateStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="py-12 text-center text-sm text-gray-400">読み込み中…</p> : items.length === 0 ? <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">見積依頼はありません</p> : items.map((request) => <section key={request.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{request.property_name}</h2><p className="mt-1 text-sm text-gray-500">{request.display_name || request.nickname} / {request.line_user_id}</p></div><Badge>{estimateStatusOptions.find(([value]) => value === request.status)?.[1] || request.status}</Badge></div>
      <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2 lg:grid-cols-4"><span>入居希望: {request.desired_move_in_date}</span><span>ペット: {request.has_pets ? 'あり' : 'なし'}</span><span>駐車場: {request.needs_parking ? '必要' : '不要'}</span><span>{new Date(request.created_at).toLocaleString('ja-JP')}</span></div>
      {request.property_address && <p className="mt-2 text-xs">所在地：{request.property_address}</p>}
      <p className="mt-2 text-xs text-gray-500">バイク：{request.has_motorbike ? 'あり' : 'なし'} ／ 駐輪場：{request.needs_bicycle_parking ? '必要' : '不要'}</p>
      {request.condition_details && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs leading-5">{request.condition_details}</p>}
      {request.property_url && <a href={request.property_url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-[#06C755] underline">{request.property_url}</a>}
      <p className="mt-2 break-all text-[10px] text-gray-300">request_id: {request.id}</p>
      <div className="mt-4 space-y-3">{request.estimates.map((estimate) => <EstimateEditor key={estimate.id} estimate={estimate} onChanged={load} onDirty={onDirty} />)}</div>
      <button type="button" className="mt-4 rounded-lg border border-[#06C755] px-4 py-2 text-sm font-semibold text-[#049b43]" onClick={() => { if (dirtyIds.current.size) { setError('未保存の変更があります。各部屋の内容を保存してから一括送信してください。'); return } setBatchPreview(request) }}>保存済みの部屋をまとめて送信</button>
    </section>)}
    {batchPreview && <div role="dialog" aria-modal="true" aria-label="複数部屋の見積送信プレビュー" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5"><h2 className="text-lg font-bold">{batchPreview.property_name} の見積を確認</h2><p className="text-xs text-gray-500">下書きの保存内容を公開し、1通のLINE通知でまとめてご案内します。対象外・キャンセルは含みません。</p>{batchPreview.estimates.filter((e) => !['out_of_scope', 'cancelled'].includes(e.status)).map((e) => <QuotePreview key={e.id} estimate={e} />)}{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex gap-3"><button disabled={sendingBatch} onClick={() => setBatchPreview(null)} className="rounded-lg border px-4 py-2">閉じる</button><button disabled={sendingBatch} className="rounded-lg bg-[#06C755] px-4 py-2 text-white" onClick={async () => { setSendingBatch(true); setError(''); try { const response = await fetchApi<ApiResponse<{ notificationSent: boolean }>>('/api/rental/requests/' + batchPreview.id + '/send', { method: 'POST', body: JSON.stringify({ revisions: batchPreview.estimates.filter((e) => !['out_of_scope', 'cancelled'].includes(e.status)).map((e) => ({ id: e.id, revision: e.revision })) }) }); if (!response.data.notificationSent) { setError('見積は公開済み、LINE通知は未完了です。同じボタンから再試行してください。'); return } setBatchPreview(null); load() } catch { setError('送信できませんでした。保存状態と月間配信上限を確認してください。') } finally { setSendingBatch(false) } }}>まとめてLINEで送信</button></div></section></div>}
  </div>
}

const piiLabels: Record<string, string> = {
  id: 'application_id', request_id: 'request_id', estimate_id: 'estimate_id', line_user_id: 'LINE userId',
  property_name: '物件名', property_url: '物件URL', room_number: '部屋番号', status: 'ステータス',
  full_name: '氏名', full_name_kana: 'フリガナ', birth_date: '生年月日', gender: '性別', phone: '電話番号', email: 'メールアドレス',
  current_postal_code: '現住所 郵便番号', current_address: '現住所', residence_type: '居住形態', residence_years: '居住年数',
  employment_category: '職業区分', employer_name: '勤務先名', employer_phone: '勤務先電話番号', employer_address: '勤務先住所',
  employment_type: '雇用形態', years_employed: '勤続年数', annual_income: '年収', desired_move_in_date: '入居予定日', occupants_count: '入居人数',
  cohabitants_json: '同居人情報', emergency_name: '緊急連絡先氏名', emergency_name_kana: '緊急連絡先フリガナ',
  emergency_relationship: '続柄', emergency_phone: '緊急連絡先電話', emergency_address: '緊急連絡先住所',
  pet_info: 'ペット情報', vehicle_info: '車両情報', motorbike_info: 'バイク情報', bicycle_parking_info: '駐輪場情報', customer_note: '顧客備考', manager_memo: '管理者メモ', created_at: '申込日時', anonymized_at: '匿名化日時',
}

function ApplicationsTab({ role }: { role: string | null }) {
  const [items, setItems] = useState<ApplicationListItem[]>([])
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [messageTemplate, setMessageTemplate] = useState('reviewing')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const query = new URLSearchParams(); if (search) query.set('search', search); if (status) query.set('status', status)
    try { setItems((await fetchApi<ApiResponse<ApplicationListItem[]>>(`/api/rental/applications?${query}`)).data) }
    catch { setError('申込一覧を読み込めませんでした') }
  }, [search, status])
  useEffect(() => { load() }, [load])
  async function open(id: string) {
    try { const data = (await fetchApi<ApiResponse<Record<string, unknown>>>(`/api/rental/applications/${id}`)).data; setSelected(data); setMemo(String(data.manager_memo ?? '')) }
    catch { setError('申込詳細を読み込めませんでした') }
  }
  const detailRows = useMemo(() => selected ? Object.entries(piiLabels).filter(([key]) => key in selected).map(([key, label]) => [label, selected[key]]) : [], [selected])

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="application_id・LINE・物件・部屋番号" className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">すべての状態</option>{applicationStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button onClick={async () => { const blob = await fetchApiBlob('/api/rental/applications/export.csv'); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'rental-applications.csv'; a.click(); URL.revokeObjectURL(url) }} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">CSV</button>
    </div>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">物件・部屋</th><th className="px-4 py-3">LINE</th><th className="px-4 py-3">状態</th><th className="px-4 py-3">申込日時</th></tr></thead><tbody className="divide-y divide-gray-100">{items.map((item) => <tr key={item.id} onClick={() => open(item.id)} className="cursor-pointer hover:bg-gray-50"><td className="px-4 py-3 font-medium">{item.propertyName} {item.roomNumber}号室<div className="text-[10px] text-gray-300">{item.id}</div></td><td className="px-4 py-3 text-gray-600">{item.displayName || item.lineUserId}</td><td className="px-4 py-3"><Badge>{item.statusLabel}</Badge></td><td className="px-4 py-3 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString('ja-JP')}</td></tr>)}</tbody></table></div>
    {selected && <div className="fixed inset-0 z-50 flex justify-end"><button className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} aria-label="閉じる" /><aside className="relative h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">審査申込詳細</h2><button onClick={() => setSelected(null)} className="text-2xl text-gray-400">×</button></div>
      <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => navigator.clipboard.writeText(detailRows.map(([label, value]) => `${label}: ${value ?? ''}`).join('\n'))} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">全項目をコピー</button>{Boolean(selected.identity_file_key) && <button onClick={async () => openBlob(await fetchApiBlob(`/api/rental/applications/${String(selected.id)}/identity`))} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">本人確認書類</button>}</div>
      <dl className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">{detailRows.map(([label, value]) => <div key={String(label)} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr]"><dt className="text-xs text-gray-500">{String(label)}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value == null ? '—' : String(value)}</dd></div>)}</dl>
      <div className="mt-5 space-y-3 rounded-xl bg-gray-50 p-4"><label className="block text-xs text-gray-500">ステータス<select value={String(selected.status)} onChange={async (e) => { await fetchApi(`/api/rental/applications/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }); await open(String(selected.id)); load() }} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">{applicationStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs text-gray-500">管理者メモ<textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" /></label><button onClick={async () => { await fetchApi(`/api/rental/applications/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ managerMemo: memo }) }); await open(String(selected.id)) }} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">メモを保存</button>
      </div>
      <div className="mt-4 rounded-xl border border-gray-200 p-4"><label className="block text-xs text-gray-500">顧客へLINE送信（個人情報を含まない固定文面）<select value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="reviewing">申込内容を確認中</option><option value="additional_information">追加確認あり</option><option value="submitted">提携先へ提出済み</option><option value="approved">審査承認</option><option value="followup">手続きの案内あり</option></select></label><button onClick={async () => { await fetchApi(`/api/rental/applications/${String(selected.id)}/message`, { method: 'POST', body: JSON.stringify({ template: messageTemplate }) }); window.alert('送信しました') }} className="mt-2 rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white">LINEで送信</button></div>
      {role === 'owner' && !Boolean(selected.anonymized_at) && <button onClick={async () => { if (!window.confirm('個人情報を匿名化します。元に戻せません。実行しますか？')) return; await fetchApi(`/api/rental/applications/${String(selected.id)}`, { method: 'DELETE' }); setSelected(null); load() }} className="mt-6 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600">個人情報を削除・匿名化</button>}
    </aside></div>}
  </div>
}

function SettingsTab({ role }: { role: string | null }) {
  const [settings, setSettings] = useState({
    privacyPolicyUrl: '', identityUploadEnabled: false, dataRetentionDays: 365,
    richMenuGroupMap: { initial: '', quotePresented: '', application: '' },
  })
  const [message, setMessage] = useState('')
  useEffect(() => { fetchApi<ApiResponse<typeof settings>>('/api/rental/settings').then((r) => setSettings({ ...r.data, privacyPolicyUrl: r.data.privacyPolicyUrl || '' })) }, [])
  if (role !== 'owner') return <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">設定変更はOwnerのみ可能です。</p>
  return <section className="max-w-xl space-y-4 rounded-xl border border-gray-200 bg-white p-5"><label className="block text-sm">プライバシーポリシーURL<input value={settings.privacyPolicyUrl} onChange={(e) => setSettings({ ...settings, privacyPolicyUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" /></label><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={settings.identityUploadEnabled} onChange={(e) => setSettings({ ...settings, identityUploadEnabled: e.target.checked })} />本人確認書類アップロードを有効にする</label><label className="block text-sm">個人情報の保持期間（日）<input type="number" min="30" max="3650" value={settings.dataRetentionDays} onChange={(e) => setSettings({ ...settings, dataRetentionDays: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" /></label>
    <div className="space-y-3 rounded-xl bg-gray-50 p-4"><div><h3 className="text-sm font-semibold">ステータス別リッチメニュー</h3><p className="mt-1 text-xs leading-5 text-gray-500">リッチメニュー画面で公開したグループIDを設定します。未設定の段階は現在のメニューを維持します。</p></div>{([['initial', '初回・見積作成中'], ['quotePresented', '見積提示済み'], ['application', '審査申込以降']] as const).map(([key, label]) => <label key={key} className="block text-xs text-gray-500">{label}<input value={settings.richMenuGroupMap[key]} onChange={(e) => setSettings({ ...settings, richMenuGroupMap: { ...settings.richMenuGroupMap, [key]: e.target.value } })} placeholder="rich_menu_group_id" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" /></label>)}</div>
    <button onClick={async () => { await fetchApi('/api/rental/settings', { method: 'PATCH', body: JSON.stringify(settings) }); setMessage('保存しました') }} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">設定を保存</button><button onClick={async () => { const result = await fetchApi<ApiResponse<{ anonymized: number }>>('/api/rental/retention/run', { method: 'POST' }); setMessage(`${result.data.anonymized}件を匿名化しました`) }} className="ml-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">保持期限切れを匿名化</button>{message && <p className="text-sm text-[#049b43]">{message}</p>}</section>
}

export default function RentalPage() {
  const [tab, setTab] = useState<'quotes' | 'applications' | 'settings'>('quotes')
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => setRole(localStorage.getItem('lh_staff_role')), [])
  return <div><div className="mb-6"><p className="text-sm font-semibold text-[#06C755]">賃貸仲介MVP</p><h1 className="mt-1 text-2xl font-bold">見積・審査申込</h1><p className="mt-2 text-sm text-gray-500">概算見積の作成から申込情報の確認までを管理します。</p></div>
    <div className="mb-5 flex gap-1 rounded-xl bg-gray-100 p-1">{([['quotes', '概算見積'], ['applications', '審査申込'], ['settings', '安全設定']] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>)}</div>
    {tab === 'quotes' && <QuoteRequestsTab />}{tab === 'applications' && (role === 'staff' ? <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">審査申込の個人情報はOwner/Adminのみ閲覧できます。</p> : <ApplicationsTab role={role} />)}{tab === 'settings' && <SettingsTab role={role} />}
    {(role === 'owner' || role === 'admin') && <RentalRichMenu />}
  </div>
}
