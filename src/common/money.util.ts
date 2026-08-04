/**
 * Formats an integer minor-unit amount (cents) into a human display string for
 * the currencies Northwind supports. Kept explicit per-currency because minor
 * units and symbol placement differ and we want zero ambiguity in receipts.
 */

interface CurrencyRule {
  symbol: string;
  minorUnits: number; // number of decimal places
  symbolBefore: boolean;
}

const CURRENCY_RULES: Record<string, CurrencyRule> = {
  usd: { symbol: '$', minorUnits: 2, symbolBefore: true },
  eur: { symbol: '€', minorUnits: 2, symbolBefore: true },
  gbp: { symbol: '£', minorUnits: 2, symbolBefore: true },
  try: { symbol: '₺', minorUnits: 2, symbolBefore: true },
  irr: { symbol: '﷼', minorUnits: 0, symbolBefore: false },
  jpy: { symbol: '¥', minorUnits: 0, symbolBefore: true },
};

const DEFAULT_RULE: CurrencyRule = {
  symbol: '',
  minorUnits: 2,
  symbolBefore: true,
};

function groupThousands(intPart: string): string {
  const out: string[] = [];
  let count = 0;
  for (let i = intPart.length - 1; i >= 0; i--) {
    out.unshift(intPart[i]);
    count++;
    if (count % 3 === 0 && i > 0) {
      out.unshift(',');
    }
  }
  return out.join('');
}

export function formatMoney(amountMinor: number, currency: string): string {
  const rule = CURRENCY_RULES[currency.toLowerCase()] || DEFAULT_RULE;

  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);

  const divisor = Math.pow(10, rule.minorUnits);
  const major = Math.floor(absolute / divisor);
  const minor = absolute % divisor;

  let body = groupThousands(String(major));
  if (rule.minorUnits > 0) {
    const minorStr = String(minor).padStart(rule.minorUnits, '0');
    body = `${body}.${minorStr}`;
  }

  let withSymbol: string;
  if (rule.symbolBefore) {
    withSymbol = `${rule.symbol}${body}`;
  } else {
    withSymbol = `${body}${rule.symbol}`;
  }

  return negative ? `-${withSymbol}` : withSymbol;
}
