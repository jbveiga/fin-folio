import { Cents, CurrencyCode } from "../types";

/**
 * Multi-Currency integer cents formatter adhering to ISO-4217 specifications.
 * Zero-float invariant: uses BigInt integer division and modulo (zero floating-point math).
 */
export function formatCurrency(
  cents: number,
  currency: CurrencyCode = "EUR",
  showPlusSign = false
): string {
  const intVal = BigInt(Math.trunc(cents || 0));
  const isNegative = intVal < 0n;
  const absVal = isNegative ? -intVal : intVal;

  const major = absVal / 100n;
  const minor = absVal % 100n;
  const sign = isNegative ? "-" : showPlusSign && intVal > 0n ? "+" : "";
  const remStr = minor.toString().padStart(2, "0");

  switch (currency) {
    case "USD": {
      const uStr = Number(major).toLocaleString("en-US");
      return `${sign}$${uStr}.${remStr}`;
    }
    case "GBP": {
      const uStr = Number(major).toLocaleString("en-GB");
      return `${sign}£${uStr}.${remStr}`;
    }
    case "CHF": {
      const uStr = Number(major).toLocaleString("de-CH");
      return `${sign}CHF ${uStr}.${remStr}`;
    }
    case "EUR":
    default: {
      const uStr = Number(major).toLocaleString("pt-PT");
      return `${sign}${uStr},${remStr} €`;
    }
  }
}

/**
 * Strictly zero-float European integer cents formatter (`145075` -> `"1.450,75 €"`, `-2350` -> `"-23,50 €"`).
 * Re-routes to formatCurrency with EUR base currency.
 */
export function formatCents(cents: Cents, showPlusSign = false): string {
  return formatCurrency(cents, "EUR", showPlusSign);
}

/**
 * Parses a European (`1.450,75`, `-30,00`) or Anglo (`1,450.75`, `-30.00`) string into integer cents (`i64`)
 * using strictly integer string parsing (zero floats).
 */
export function parseCentsInput(raw: string): Cents {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  let isNegative = trimmed.includes("-");
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    isNegative = true;
  }

  const unsigned = trimmed.replace(/[^0-9.,]/g, "");
  if (!unsigned) return 0;

  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);

  let majorDigits = "";
  let minorDigits = "";

  if (lastSep >= 0) {
    const afterSep = unsigned.slice(lastSep + 1).replace(/[^0-9]/g, "");
    const beforeSep = unsigned.slice(0, lastSep).replace(/[^0-9]/g, "");
    if (afterSep.length <= 2) {
      majorDigits = beforeSep;
      minorDigits = afterSep;
    } else {
      majorDigits = unsigned.replace(/[^0-9]/g, "");
    }
  } else {
    majorDigits = unsigned.replace(/[^0-9]/g, "");
  }

  const major = majorDigits ? parseInt(majorDigits, 10) : 0;
  let minor = 0;
  if (minorDigits.length === 1) {
    minor = parseInt(minorDigits, 10) * 10;
  } else if (minorDigits.length >= 2) {
    minor = parseInt(minorDigits.slice(0, 2), 10);
  }

  const total = major * 100 + minor;
  return isNegative ? -total : total;
}
