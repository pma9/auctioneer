import { afterEach, describe, expect, it } from "vitest";
import { getPhoneLast4, hashPhoneNumber } from "@/lib/auction/phone";

const originalPepper = process.env.PHONE_HASH_PEPPER;

afterEach(() => {
  process.env.PHONE_HASH_PEPPER = originalPepper;
});

describe("phone hashing", () => {
  it("requires PHONE_HASH_PEPPER before hashing", () => {
    delete process.env.PHONE_HASH_PEPPER;

    expect(() => hashPhoneNumber("555-555-0123")).toThrow(
      "PHONE_HASH_PEPPER must be set before hashing phone numbers.",
    );
  });

  it("hashes normalized phone numbers with the configured pepper", () => {
    process.env.PHONE_HASH_PEPPER = "test-pepper";

    expect(hashPhoneNumber("555-555-0123")).toBe(hashPhoneNumber("+1 555 555 0123"));
  });

  it("returns the last four digits from normalized phone input", () => {
    expect(getPhoneLast4("(555) 555-0123")).toBe("0123");
  });
});
