import { describe, expect, it } from "vitest";
import { parseGen, formatGen, bpsShare } from "@/lib/genlayer/gen";

describe("GEN base-unit conversion", () => {
  it("round-trips whole numbers", () => {
    expect(parseGen("1000")).toBe(1000n * 10n ** 18n);
    expect(formatGen(1000n * 10n ** 18n)).toBe("1000");
  });

  it("round-trips fractional amounts", () => {
    const base = parseGen("1.5");
    expect(base).toBe(1500000000000000000n);
    expect(formatGen(base)).toBe("1.5");
  });

  it("rejects malformed input", () => {
    expect(() => parseGen("abc")).toThrow();
    expect(() => parseGen("-1")).toThrow();
  });

  it("computes an exact deterministic bps share", () => {
    expect(bpsShare(1000n, 2500)).toBe(250n);
    expect(bpsShare(1000n, 10000)).toBe(1000n);
  });
});
