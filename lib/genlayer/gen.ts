/**
 * BigInt-safe GEN <-> base-unit conversion. GEN has 18 decimals, exactly
 * like the EVM native currency convention. Never use floating point for
 * money — every amount that reaches a contract call is a bigint of base
 * units (wei-equivalent).
 */
const DECIMALS = 18n;
const UNIT = 10n ** DECIMALS;

export function parseGen(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" is not a valid GEN amount`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) {
    throw new Error("GEN amounts support at most 18 decimal places");
  }
  const paddedFrac = frac.padEnd(18, "0");
  return BigInt(whole || "0") * UNIT + BigInt(paddedFrac || "0");
}

export function formatGen(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

export function formatGenShort(amount: bigint, maxDecimals = 4): string {
  const full = formatGen(amount);
  const [whole = "0", frac = ""] = full.split(".");
  if (!frac) return whole;
  return `${whole}.${frac.slice(0, maxDecimals)}`;
}

export function bpsShare(total: bigint, bps: number): bigint {
  return (total * BigInt(bps)) / 10000n;
}
