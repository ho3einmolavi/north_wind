import { formatMoney } from '../src/common/money.util';

describe('formatMoney', () => {
  it('formats usd with two minor units', () => {
    expect(formatMoney(4000, 'usd')).toBe('$40.00');
    expect(formatMoney(2500, 'usd')).toBe('$25.00');
    expect(formatMoney(5, 'usd')).toBe('$0.05');
  });

  it('groups thousands', () => {
    expect(formatMoney(123456789, 'usd')).toBe('$1,234,567.89');
  });

  it('handles zero-minor-unit currencies', () => {
    expect(formatMoney(1500, 'jpy')).toBe('¥1,500');
  });

  it('places the symbol after for irr', () => {
    expect(formatMoney(1000, 'irr')).toBe('1,000﷼');
  });

  it('handles negative amounts', () => {
    expect(formatMoney(-4000, 'usd')).toBe('-$40.00');
  });

  it('falls back gracefully for unknown currencies', () => {
    expect(formatMoney(4000, 'xyz')).toBe('40.00');
  });
});
