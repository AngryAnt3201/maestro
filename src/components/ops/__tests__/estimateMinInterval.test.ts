import { describe, it, expect } from "vitest";
import { estimateMinIntervalSec } from "../wizard/ClaudeTriggerForm";

describe("estimateMinIntervalSec", () => {
  it("rejects every-minute", () => {
    expect(estimateMinIntervalSec("* * * * *")).toBe(60);
  });
  it("rejects */30 minute", () => {
    expect(estimateMinIntervalSec("*/30 * * * *")).toBe(30 * 60);
  });
  it("accepts */2 hour", () => {
    expect(estimateMinIntervalSec("0 */2 * * *")).toBe(3600);
  });
  it("accepts specific minute each hour (>=1h)", () => {
    expect(estimateMinIntervalSec("15 * * * *")).toBe(3600);
  });
  it("accepts daily 9am", () => {
    expect(estimateMinIntervalSec("0 9 * * *")).toBe(3600);
  });
});
