import { describe, expect, it } from "vitest";
import { allocate, applyBps, convert, CurrencyMismatchError, formatMoney, lineTotal, parseMajor, percent, sum, toMajorString, totalsByCurrency } from "@/lib/money";

describe("money", () => {
  it("parses major amounts exactly", () => {
    expect(parseMajor("1,250.50", "NGN")).toBe(125050);
    expect(parseMajor("0.1", "USD") + parseMajor("0.2", "USD")).toBe(30);
    expect(parseMajor("1500", "JPY")).toBe(1500);
    expect(() => parseMajor("1.005", "NGN")).toThrow(/decimal places/);
    expect(() => parseMajor("abc", "NGN")).toThrow();
    expect(() => parseMajor("1.5", "JPY")).toThrow();
  });
  it("formats and round-trips", () => {
    expect(toMajorString(125050, "NGN")).toBe("1250.50");
    expect(formatMoney(125050, "NGN")).toMatch(/1,250\.50/);
  });
  it("rounds line totals half away from zero", () => {
    expect(lineTotal("2.5", 3)).toBe(8);
    expect(lineTotal(3, 333)).toBe(999);
    expect(applyBps(10000, 750)).toBe(750);
  });
  it("never mixes currencies", () => {
    expect(() => sum([{ amountMinor: 1, currency: "NGN" }, { amountMinor: 1, currency: "USD" }])).toThrow(CurrencyMismatchError);
    expect(totalsByCurrency([{ amountMinor: 1, currency: "NGN" }, { amountMinor: 2, currency: "USD" }, { amountMinor: 3, currency: "NGN" }])).toEqual([{ currency: "NGN", amountMinor: 4 }, { currency: "USD", amountMinor: 2 }]);
  });
  it("allocates exactly", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts.sort()).toEqual([33, 33, 34]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
  });
  it("converts only with an explicit rate", () => {
    const r = convert({ amountMinor: 1000, currency: "USD" }, { from: "USD", to: "NGN", rate: "1500.25", asOf: "2026-10-01T00:00:00Z", source: "test" });
    expect(r.amountMinor).toBe(1500250);
    expect(() => convert({ amountMinor: 1, currency: "GBP" }, { from: "USD", to: "NGN", rate: "1", asOf: "", source: "" })).toThrow();
  });
  it("percent handles zero denominators", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33.3);
  });
});
