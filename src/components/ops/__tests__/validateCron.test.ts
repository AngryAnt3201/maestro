import { describe, expect, it } from "vitest";
import { validateCron } from "../wizard/MaestroJobForm";

describe("validateCron", () => {
  it("accepts empty string (manual-only)", () => {
    expect(validateCron("")).toBeNull();
  });

  it("accepts valid 5-field expressions", () => {
    expect(validateCron("0 9 * * *")).toBeNull();
    expect(validateCron("*/15 * * * *")).toBeNull();
    expect(validateCron("0 0 1,15 * *")).toBeNull();
    expect(validateCron("0 9-17 * * 1-5")).toBeNull();
  });

  it("rejects wrong field count", () => {
    expect(validateCron("0 9 * *")).toMatch(/5 fields/);
  });

  it("rejects out-of-range values", () => {
    expect(validateCron("0 25 * * *")).toMatch(/range/);
    expect(validateCron("60 * * * *")).toMatch(/range/);
  });
});
