import { Cents } from "../types";

/**
 * Strictly zero-float European integer cents formatter (`145075` -> `"1.450,75 €"`, `-2350` -> `"-23,50 €"`).
 * Uses BigInt integer division and modulo so floating-point math is never invoked.
 */
export function formatCents(cents: Cents, showPlusSign = false): string {
  const intVal = BigInt(Math.trunc(cents || 0));
  const isNeg = intVal < 0n;
  const absVal = isNeg ? -intVal : intVal;

  const major = absVal / 100n;
  const minor = absVal % 100n;

  const majorStr = major.toString();
  let grouped = "";
  for (let i = 0; i < majorStr.length; i++) {
    const revIdx = majorStr.length - 1 - i;
    grouped = majorStr[revIdx] + grouped;
    if (i % 3 === 2 && revIdx > 0) {
      grouped = "." + grouped;
    }
  }

  const minorStr = minor.toString().padStart(2, "0");
  const sign = isNeg ? "-" : showPlusSign && intVal > 0n ? "+" : "";
  return `${sign}${grouped},${minorStr} €`;
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
