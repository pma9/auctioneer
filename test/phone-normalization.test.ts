import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "@/lib/auction/phone-normalization";

describe("phone normalization", () => {
  it.each([
    ["5555550123", "+15555550123"],
    ["555-555-0123", "+15555550123"],
    ["(555) 555-0123", "+15555550123"],
    ["1 (555) 555-0123", "+15555550123"],
    ["+1 555 555 0123", "+15555550123"],
  ])("normalizes US phone input %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it("rejects non-US phone numbers", () => {
    expect(() => normalizePhoneNumber("+44 20 7946 0958")).toThrow("Enter a valid US phone number.");
  });

  it("rejects invalid US phone numbers", () => {
    expect(() => normalizePhoneNumber("1555")).toThrow("Enter a valid US phone number.");
  });
});
