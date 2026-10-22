import { CurrencyCode, CurrencyConfig, FxRateConfig } from "../types";

export const DEFAULT_FX_RATES: FxRateConfig = {
  baseCurrency: "EUR",
  ratesBasisPoints: {
    EUR: 10000,
    USD: 9200,   // 0.9200 EUR per 1 USD
    GBP: 11650,  // 1.1650 EUR per 1 GBP
    CHF: 10350,  // 1.0350 EUR per 1 CHF
  },
};

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  EUR: {
    code: "EUR",
    symbol: "€",
    name: "Euro",
    decimalSeparator: ",",
    thousandsSeparator: ".",
    symbolPosition: "after",
  },
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    decimalSeparator: ".",
    thousandsSeparator: ",",
    symbolPosition: "before",
  },
  GBP: {
    code: "GBP",
    symbol: "£",
    name: "British Pound",
    decimalSeparator: ".",
    thousandsSeparator: ",",
    symbolPosition: "before",
  },
  CHF: {
    code: "CHF",
    symbol: "CHF",
    name: "Swiss Franc",
    decimalSeparator: ".",
    thousandsSeparator: "'",
    symbolPosition: "before",
  },
};

/**
 * Deterministic integer basis point FX conversion with Banker's rounding (round half to even).
 * Rate is defined in Basis Points (1 bp = 0.0001, 10,000 bp = 1.0000 base currency units per 1 foreign unit).
 * Strictly zero-float: uses BigInt integer multiplication, division, and modulo.
 */
export function convertCurrencyBasisPoints(
  foreignCents: number,
  rateBp: number
): number {
  if (rateBp === 10000 || foreignCents === 0) {
    return Math.trunc(foreignCents || 0);
  }
  const isNegative = foreignCents < 0;
  const absCents = BigInt(Math.abs(Math.trunc(foreignCents || 0)));
  const bp = BigInt(Math.abs(Math.trunc(rateBp || 10000)));

  const product = absCents * bp;
  const quotient = product / 10000n;
  const remainder = product % 10000n;

  let rounded = quotient;
  if (remainder > 5000n) {
    rounded = quotient + 1n;
  } else if (remainder === 5000n) {
    // Round half to even: if quotient is odd, add 1 to make it even
    if (quotient % 2n !== 0n) {
      rounded = quotient + 1n;
    }
  }

  const res = Number(rounded);
  return isNegative ? -res : res;
}

/**
 * Converts integer cents between any two supported currencies using basis point FX configuration.
 */
export function convertCurrency(
  cents: number,
  from: CurrencyCode,
  to: CurrencyCode,
  config: FxRateConfig = DEFAULT_FX_RATES
): number {
  if (from === to || cents === 0) {
    return Math.trunc(cents || 0);
  }

  // 1. Foreign -> Base Currency
  if (to === config.baseCurrency) {
    const rateBp = config.ratesBasisPoints[from] ?? 10000;
    return convertCurrencyBasisPoints(cents, rateBp);
  }

  // 2. Base Currency -> Foreign
  if (from === config.baseCurrency) {
    const rateBp = config.ratesBasisPoints[to] ?? 10000;
    if (rateBp === 10000) return cents;
    const isNegative = cents < 0;
    const absCents = BigInt(Math.abs(Math.trunc(cents || 0)));
    const bp = BigInt(rateBp);

    // Foreign = (Base * 10000) / rateBp with Banker's rounding
    const product = absCents * 10000n;
    const quotient = product / bp;
    const remainder = product % bp;
    const half = bp / 2n;

    let rounded = quotient;
    if (remainder > half) {
      rounded = quotient + 1n;
    } else if (remainder === half && bp % 2n === 0n) {
      if (quotient % 2n !== 0n) {
        rounded = quotient + 1n;
      }
    }

    const res = Number(rounded);
    return isNegative ? -res : res;
  }

  // 3. Cross currency conversion (Foreign A -> Base -> Foreign B)
  const inBase = convertCurrency(cents, from, config.baseCurrency, config);
  return convertCurrency(inBase, config.baseCurrency, to, config);
}
