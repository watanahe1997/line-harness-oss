'use client'

import { useState } from 'react'
import { fetchApi } from '@/lib/api'

type ApiResult<T> = { success: boolean; data: T; error?: string }
type Menu = {
  richMenuId?: string; name: string; selected: boolean; chatBarText: string;
  size: { width: number; height: number };
  areas: Array<{ bounds: Record<string, number>; action: { type: string; label: string; uri: string } }>;
}

async function checked<T>(path: string, options?: RequestInit): Promise<T> {
  const result = await fetchApi<ApiResult<T>>(path, options)
  if (!result.success) throw new Error(result.error || 'リッチメニューを設定できませんでした')
  return result.data
}

export default function RentalRichMenu() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function publish() {
    setBusy(true); setMessage(''); setError('')
    try {
      const configResponse = await fetch('/rental-rich-menu/rich-menu.json')
      const imageResponse = await fetch('/rental-rich-menu/rental-rich-menu.png')
      if (!configResponse.ok || !imageResponse.ok) throw new Error('メニュー画像を読み込めませんでした')
      const config = await configResponse.json() as Menu
      const image = await imageResponse.blob()
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('画像を読み込めませんでした'))
        reader.readAsDataURL(image)
      })
      const menus = await checked<Menu[]>('/api/rich-menus')
      const existing = menus.find((menu) => menu.name === config.name &&
        JSON.stringify(menu.areas) === JSON.stringify(config.areas) &&
        menu.size.width === config.size.width && menu.size.height === config.size.height)
      const menuId = existing?.richMenuId ?? (await checked<{ richMenuId: string }>('/api/rich-menus', {
        method: 'POST', body: JSON.stringify(config),
      })).richMenuId
      await checked(`/api/rich-menus/${encodeURIComponent(menuId)}/image`, {
        method: 'POST', body: JSON.stringify({ imageData, contentType: 'image/png' }),
      })
      await checked(`/api/rich-menus/${encodeURIComponent(menuId)}/default`, { method: 'POST' })
      const current = await checked<{ richMenuId: string | null }>('/api/rich-menus/default')
      if (current.richMenuId !== menuId) throw new Error('LINEへの反映を確認できませんでした。もう一度お試しください。')
      setMessage('公式LINEの標準メニューに設定しました。LINEのトークを開き直して確認してください。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 max-w-2xl space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="font-bold">公式LINEの見積メニュー</h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          「見積を依頼する」と「概算見積を見る」の2つの入口を、トーク画面の下に表示します。
          概算見積の一覧は、お客様ご本人に提示した見積だけを表示します。
        </p>
      </div>
      <img src="/rental-rich-menu/rental-rich-menu.png" width={2500} height={843} alt="左：見積を依頼する、右：概算見積を見る" className="w-full rounded-lg" />
      <p className="text-xs leading-5 text-gray-500">
        現在接続中の公式LINEの標準メニューに設定します。個別に設定済みのメニューがあるお客様には、そのメニューが優先されます。
      </p>
      <button type="button" onClick={publish} disabled={busy} className="rounded-lg bg-[#049b43] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'LINEに設定しています…' : 'このメニューを公式LINEに設定する'}
      </button>
      {message && <p role="status" className="text-sm text-[#049b43]">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
