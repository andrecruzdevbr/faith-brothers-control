import { describe, it, expect } from "vitest";
import {
  getBillingSettings,
  getMissingBillingSkipStatus,
} from "../../supabase/functions/_shared/billing-settings.ts";

const sampleSettings = {
  boleto_issue_day: 1,
  boleto_due_day: 28,
  send_whatsapp_automatically: false,
};

describe("getBillingSettings", () => {
  it("returns object when relation is a single embed", () => {
    expect(getBillingSettings(sampleSettings)).toEqual(sampleSettings);
  });

  it("returns first item when relation is an array", () => {
    expect(getBillingSettings([sampleSettings])).toEqual(sampleSettings);
    expect(getBillingSettings([sampleSettings, { ...sampleSettings, boleto_issue_day: 5 }])).toEqual(
      sampleSettings,
    );
  });

  it("returns null for null, undefined, or empty array", () => {
    expect(getBillingSettings(null)).toBeNull();
    expect(getBillingSettings(undefined)).toBeNull();
    expect(getBillingSettings([])).toBeNull();
  });
});

describe("getMissingBillingSkipStatus", () => {
  it("returns null when plan and settings exist", () => {
    expect(getMissingBillingSkipStatus(true, true)).toBeNull();
  });

  it("returns specific skip codes", () => {
    expect(getMissingBillingSkipStatus(false, true)).toBe("skipped_missing_plan");
    expect(getMissingBillingSkipStatus(true, false)).toBe("skipped_missing_billing_settings");
    expect(getMissingBillingSkipStatus(false, false)).toBe("skipped_missing_plan_and_settings");
  });
});
