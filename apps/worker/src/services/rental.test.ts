import { describe, expect, it } from 'vitest';
import {
  calculatePaymentTotal,
  csvCell,
  validateQuoteRequestBody,
} from './rental.js';

describe('rental service', () => {
  it('calculates initial payment after discounts and cashback', () => {
    expect(calculatePaymentTotal({ rent: 80_000, management_fee: 5_000, brokerage_fee: 88_000, brokerage_discount: 20_000, cashback: 5_000 })).toBe(148_000);
  });

  it('validates one to five unique room numbers', () => {
    const result = validateQuoteRequestBody({
      propertyName: 'テストマンション',
      roomNumbers: ['101', '101', '202'],
      desiredMoveInDate: '2026-07-01',
      nickname: 'れい',
      hasPets: false,
      needsParking: true,
      hasMotorbike: false,
      needsBicycleParking: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roomNumbers).toEqual(['101', '202']);
  });

  it('accepts a property URL when a property name is omitted', () => {
    const result = validateQuoteRequestBody({
      propertyUrl: 'https://example.com/rooms/101', roomNumbers: ['101'],
      desiredMoveInDate: '2026-07-01', nickname: 'れい', hasPets: false,
      needsParking: false, hasMotorbike: false, needsBicycleParking: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.propertyName).toBe('https://example.com/rooms/101');
  });

  it('neutralizes spreadsheet formulas in CSV', () => {
    expect(csvCell('=HYPERLINK("https://example.com")')).toBe('"\'=HYPERLINK(""https://example.com"")"');
  });
});
