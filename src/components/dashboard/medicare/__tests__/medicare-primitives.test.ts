import { formatCurrency, maskMbi } from '@/components/dashboard/medicare/medicare-primitives';

describe('Medicare privacy-safe display helpers', () => {
  it('masks an MBI and preserves only the last four characters', () => {
    expect(maskMbi('1EG4-TE5-MK72')).toBe('••••••MK72');
  });

  it('does not expose a missing MBI as a mask', () => {
    expect(maskMbi(null)).toBe('Not recorded');
  });

  it('formats annualized premium values as currency', () => {
    expect(formatCurrency(12345)).toBe('$12,345');
  });
});
