import { describe, expect, it } from "vitest";
import { auctionItemValidationErrors } from "@/lib/auction/item-validation";
import type { AuctionItem } from "@/lib/auction/types";

function baseItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "i1",
    name: "Jersey",
    normalizedName: "jersey",
    notes: "",
    msrp: 100,
    startingPrice: 10,
    lockInPrice: 50,
    status: "draft",
    ...overrides,
  };
}

describe("auctionItemValidationErrors", () => {
  it("returns empty when item is valid", () => {
    expect(auctionItemValidationErrors(baseItem())).toEqual([]);
  });

  it("prefers importValidationErrors when present", () => {
    expect(
      auctionItemValidationErrors(baseItem({ importValidationErrors: ["Starting price is missing."] })),
    ).toEqual(["Starting price is missing."]);
  });

  it("detects missing name and bad prices", () => {
    expect(auctionItemValidationErrors(baseItem({ name: "  " }))).toContain("Item name is missing.");
    expect(auctionItemValidationErrors(baseItem({ startingPrice: Number.NaN })).length).toBeGreaterThan(0);
  });
});
