import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import RentalLayout, { Field, cardClass, inputClass, primaryButtonClass } from '../components/RentalLayout.js';
import { fileToDataUrl, rentalApi } from '../lib/rental-api.js';

const initial = {
  fullName: '', fullNameKana: '', birthDate: '', gender: '', phone: '', email: '',
  currentPostalCode: '', currentAddress: '', residenceType: '', residenceYears: '',
  employmentCategory: '', employerName: '', employerPhone: '', employerAddress: '',
  employmentType: '', yearsEmployed: '', annualIncome: '', desiredMoveInDate: '',
  occupantsCount: '1', emergencyName: '', emergencyNameKana: '', emergencyRelationship: '',
  emergencyPhone: '', emergencyAddress: '', petInfo: '', vehicleInfo: '', motorbikeInfo: '',
  bicycleParkingInfo: '', customerNote: '',
};

type FormState = typeof initial;
type Cohabitant = { name: string; relationship: string; birthDate: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={`${cardClass} space-y-4`}><h2 className="border-b border-gray-100 pb-3 font-bold">{title}</h2>{children}</section>;
}

export default function RentalApplication() {
  const { estimateId = '' } = useParams();
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof rentalApi.preview>> | null>(null);
  const [settings, setSettings] = useState<{ privacyPolicyUrl: string | null; identityUploadEnabled: boolean } | null>(null);
  const [form, setForm] = useState<FormState>(initial);
  const [cohabitants, setCohabitants] = useState<Cohabitant[]>([]);
  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [consents, setConsents] = useState({ privacy: false, sharing: false, accurate: false, additional: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ applicationId: string; identityUploaded: boolean; identityUploadFailed: boolean } | null>(null);
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    Promise.all([rentalApi.preview(estimateId), rentalApi.settings()])
      .then(([nextPreview, nextSettings]) => { setPreview(nextPreview); setSettings(nextSettings); })
      .catch((err) => setError(err.message));
  }, [estimateId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await rentalApi.apply(estimateId, {
        ...form,
        residenceYears: Number(form.residenceYears), yearsEmployed: Number(form.yearsEmployed),
        annualIncome: Number(form.annualIncome), occupantsCount: Number(form.occupantsCount),
        cohabitantPresent: cohabitants.length > 0, cohabitants,
        consentPrivacy: consents.privacy, consentDataSharing: consents.sharing,
        confirmedAccurate: consents.accurate, consentAdditionalInfo: consents.additional,
      });
      let identityUploaded = false;
      let identityUploadFailed = false;
      if (identityFile && settings?.identityUploadEnabled) {
        try {
          const data = await fileToDataUrl(identityFile);
          await rentalApi.uploadIdentity(result.applicationId, { data, mimeType: identityFile.type, filename: identityFile.name });
          identityUploaded = true;
        } catch {
          // The application itself is already committed. Do not present it as
          // a failed application or invite a duplicate retry.
          identityUploadFailed = true;
        }
      }
      setDone({ applicationId: result.applicationId, identityUploaded, identityUploadFailed });
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信できませんでした');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return (
    <RentalLayout title="審査申込">
      <section className={`${cardClass} text-center`}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#06C755]/10 text-2xl text-[#06C755]">✓</div>
        <h2 className="text-lg font-bold">審査申込情報を受け付けました</h2>
        <p className="mt-3 text-sm leading-6 text-gray-600">内容を確認し、次の手続きをLINEでご案内します。</p>
        {done.identityUploadFailed && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-800">申込は完了していますが、本人確認書類だけアップロードできませんでした。担当者からの案内をお待ちください。</p>}
        <p className="mt-4 break-all rounded-lg bg-gray-50 p-3 text-left text-xs text-gray-500">application_id: {done.applicationId}</p>
      </section>
    </RentalLayout>
  );

  if (!preview || !settings) return <RentalLayout title="審査申込">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <p className="py-12 text-center text-sm text-gray-500">読み込み中…</p>}</RentalLayout>;

  return (
    <RentalLayout title="審査申込情報を入力する">
      <section className={cardClass}><p className="text-xs text-gray-400">申込対象</p><p className="mt-1 font-bold">{preview.propertyName} <span className="text-[#06C755]">{preview.roomNumber}号室</span></p></section>
      <form onSubmit={submit} className="space-y-4">
        <Section title="本人情報">
          <Field label="氏名" required><input className={inputClass} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required /></Field>
          <Field label="フリガナ" required><input className={inputClass} value={form.fullNameKana} onChange={(e) => set('fullNameKana', e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="生年月日" required><input className={inputClass} type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required /></Field><Field label="性別" required><select className={inputClass} value={form.gender} onChange={(e) => set('gender', e.target.value)} required><option value="">選択</option><option>男性</option><option>女性</option><option>その他・回答しない</option></select></Field></div>
          <Field label="電話番号" required><input className={inputClass} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} required /></Field>
          <Field label="メールアドレス" required><input className={inputClass} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
          <Field label="現住所 郵便番号" required><input className={inputClass} inputMode="numeric" value={form.currentPostalCode} onChange={(e) => set('currentPostalCode', e.target.value)} required /></Field>
          <Field label="現住所" required><textarea className={inputClass} value={form.currentAddress} onChange={(e) => set('currentAddress', e.target.value)} required rows={3} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="居住形態" required><input className={inputClass} value={form.residenceType} onChange={(e) => set('residenceType', e.target.value)} required placeholder="賃貸・持家など" /></Field><Field label="居住年数" required><input className={inputClass} type="number" min="0" value={form.residenceYears} onChange={(e) => set('residenceYears', e.target.value)} required /></Field></div>
        </Section>

        <Section title="勤務先情報">
          <Field label="職業区分" required><input className={inputClass} value={form.employmentCategory} onChange={(e) => set('employmentCategory', e.target.value)} required /></Field>
          <Field label="勤務先名" required><input className={inputClass} value={form.employerName} onChange={(e) => set('employerName', e.target.value)} required /></Field>
          <Field label="勤務先電話番号" required><input className={inputClass} type="tel" value={form.employerPhone} onChange={(e) => set('employerPhone', e.target.value)} required /></Field>
          <Field label="勤務先住所" required><textarea className={inputClass} value={form.employerAddress} onChange={(e) => set('employerAddress', e.target.value)} required rows={2} /></Field>
          <Field label="雇用形態" required><input className={inputClass} value={form.employmentType} onChange={(e) => set('employmentType', e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="勤続年数" required><input className={inputClass} type="number" min="0" value={form.yearsEmployed} onChange={(e) => set('yearsEmployed', e.target.value)} required /></Field><Field label="年収（円）" required><input className={inputClass} type="number" min="0" value={form.annualIncome} onChange={(e) => set('annualIncome', e.target.value)} required /></Field></div>
        </Section>

        <Section title="入居情報">
          <div className="grid grid-cols-2 gap-3"><Field label="入居予定日" required><input className={inputClass} type="date" value={form.desiredMoveInDate} onChange={(e) => set('desiredMoveInDate', e.target.value)} required /></Field><Field label="入居人数" required><input className={inputClass} type="number" min="1" max="20" value={form.occupantsCount} onChange={(e) => set('occupantsCount', e.target.value)} required /></Field></div>
          <div><div className="mb-2 text-sm font-medium text-gray-700">同居人</div>{cohabitants.map((person, index) => <div key={index} className="mb-3 space-y-2 rounded-xl bg-gray-50 p-3"><input className={inputClass} placeholder="氏名" value={person.name} onChange={(e) => setCohabitants((list) => list.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /><input className={inputClass} placeholder="続柄" value={person.relationship} onChange={(e) => setCohabitants((list) => list.map((item, i) => i === index ? { ...item, relationship: e.target.value } : item))} /><input className={inputClass} type="date" value={person.birthDate} onChange={(e) => setCohabitants((list) => list.map((item, i) => i === index ? { ...item, birthDate: e.target.value } : item))} /><button type="button" className="text-sm text-red-500" onClick={() => setCohabitants((list) => list.filter((_, i) => i !== index))}>削除</button></div>)}<button type="button" className="text-sm font-semibold text-[#06C755]" onClick={() => setCohabitants((list) => [...list, { name: '', relationship: '', birthDate: '' }])}>＋ 同居人を追加</button></div>
        </Section>

        <Section title="緊急連絡先">
          <Field label="氏名" required><input className={inputClass} value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} required /></Field>
          <Field label="フリガナ" required><input className={inputClass} value={form.emergencyNameKana} onChange={(e) => set('emergencyNameKana', e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="続柄" required><input className={inputClass} value={form.emergencyRelationship} onChange={(e) => set('emergencyRelationship', e.target.value)} required /></Field><Field label="電話番号" required><input className={inputClass} type="tel" value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} required /></Field></div>
          <Field label="住所" required><textarea className={inputClass} value={form.emergencyAddress} onChange={(e) => set('emergencyAddress', e.target.value)} required rows={2} /></Field>
        </Section>

        <Section title="その他">
          <Field label="ペット情報"><textarea className={inputClass} value={form.petInfo} onChange={(e) => set('petInfo', e.target.value)} rows={2} /></Field>
          <Field label="車両情報"><textarea className={inputClass} value={form.vehicleInfo} onChange={(e) => set('vehicleInfo', e.target.value)} rows={2} /></Field>
          <Field label="バイク情報"><textarea className={inputClass} value={form.motorbikeInfo} onChange={(e) => set('motorbikeInfo', e.target.value)} rows={2} /></Field>
          <Field label="駐輪場利用情報"><textarea className={inputClass} value={form.bicycleParkingInfo} onChange={(e) => set('bicycleParkingInfo', e.target.value)} rows={2} /></Field>
          <Field label="備考"><textarea className={inputClass} value={form.customerNote} onChange={(e) => set('customerNote', e.target.value)} rows={3} /></Field>
          {settings.identityUploadEnabled && <Field label="本人確認書類（任意・10MB以下）"><input className={inputClass} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setIdentityFile(e.target.files?.[0] ?? null)} /></Field>}
        </Section>

        <Section title="確認・同意">
          {([
            ['privacy', <>個人情報の取扱い{settings.privacyPolicyUrl && <>（<a href={settings.privacyPolicyUrl} target="_blank" rel="noreferrer" className="text-[#06C755] underline">詳細</a>）</>}に同意します</>],
            ['sharing', '審査に必要な範囲で、提携先・管理会社・保証会社・貸主・保険会社等へ情報提供することに同意します'],
            ['accurate', '入力内容に虚偽がないことを確認します'],
            ['additional', '物件により追加情報や別フォームの入力が必要になる場合があることに同意します'],
          ] as Array<[keyof typeof consents, React.ReactNode]>).map(([key, label]) => <label key={String(key)} className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#06C755]" checked={consents[key]} onChange={(e) => setConsents((current) => ({ ...current, [key]: e.target.checked }))} required /><span>{label}</span></label>)}
        </Section>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className={primaryButtonClass} disabled={submitting}>{submitting ? '送信中…' : '審査申込情報を送信する'}</button>
      </form>
    </RentalLayout>
  );
}
