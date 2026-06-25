import type { ReactNode } from 'react';

export default function RentalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f5f7f5] pb-10 text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold tracking-wide text-[#06C755]">賃貸サポート</p>
          <h1 className="mt-1 text-lg font-bold">{title}</h1>
        </div>
      </header>
      <div className="mx-auto max-w-xl space-y-4 px-4 pt-5">{children}</div>
    </main>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}{required && <span className="ml-1 text-red-500">必須</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base outline-none transition focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/15';
export const cardClass = 'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm';
export const primaryButtonClass = 'w-full rounded-xl bg-[#06C755] px-4 py-3.5 font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50';
