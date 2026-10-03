/** Amounts are yen. null means unknown; zero means confirmed free. */
export const RENTAL_INITIAL_FIELDS = [
  'deposit', 'keyMoney', 'advanceRent', 'proratedRent', 'fireInsurance',
  'guaranteeCompanyFee', 'keyExchangeFee', 'cleaningFee', 'otherInitialCost', 'brokerageFee',
] as const;
export const RENTAL_MONEY_LABELS = {
  rent: '月額家賃', managementFee: '月額共益費・管理費', monthlyOtherCost: 'その他月額費用（駐車場など）',
  deposit: '敷金', keyMoney: '礼金', advanceRent: '前家賃・前共益費', proratedRent: '日割り家賃・共益費',
  fireInsurance: '火災保険', guaranteeCompanyFee: '保証会社費用', keyExchangeFee: '鍵交換費',
  cleaningFee: '入居時クリーニング費', otherInitialCost: 'その他初期費用', brokerageFee: '仲介手数料',
  brokerageDiscount: '仲介手数料割引', cashback: '入金確認後のキャッシュバック',
} as const;
export type RentalMoneyKey = keyof typeof RENTAL_MONEY_LABELS;
export function rentalPricing(values: Partial<Record<RentalMoneyKey, number | null>>) {
  const monthlyKeys = ['rent', 'managementFee', 'monthlyOtherCost'] as const;
  const unknownInitialFields = [...RENTAL_INITIAL_FIELDS, 'brokerageDiscount' as const]
    .filter((key) => values[key] == null);
  const sum = (keys: readonly RentalMoneyKey[]) => keys.reduce((total, key) => total + (values[key] ?? 0), 0);
  const upfrontSubtotal = Math.max(0, sum(RENTAL_INITIAL_FIELDS) - (values.brokerageDiscount ?? 0));
  const monthlySubtotal = sum(monthlyKeys);
  const upfrontTotal = unknownInitialFields.length ? null : upfrontSubtotal;
  return {
    upfrontTotal, upfrontSubtotal, unknownInitialFields,
    monthlyTotal: monthlyKeys.some((key) => values[key] == null) ? null : monthlySubtotal,
    monthlySubtotal,
    effectiveTotal: upfrontTotal == null || values.cashback == null ? null : Math.max(0, upfrontTotal - values.cashback),
    invalidDiscount: values.brokerageDiscount != null && values.brokerageFee != null && values.brokerageDiscount > values.brokerageFee,
    invalidCashback: upfrontTotal != null && values.cashback != null && values.cashback > upfrontTotal,
  };
}
export const RENTAL_CASHBACK_NOTE = '初期費用の入金確認後、PayPayまたはAmazonギフト券でキャッシュバックします。初期費用からの差し引きではありません。';
