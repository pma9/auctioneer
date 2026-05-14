import { describe, expect, it } from "vitest";
import {
  allSelectedPublishable,
  allSelectedUnpublishable,
  canPublishItem,
  canUnpublishItem,
  itemFormWouldBeValid,
  publishableDraftItems,
} from "@/lib/auction/item-publish";
import type { AuctionItem, Bid } from "@/lib/auction/types";

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

describe("item-publish helpers", () => {
  it("canPublishItem requires draft and valid fields", () => {
    expect(canPublishItem(baseItem({ status: "draft" }))).toBe(true);
    expect(canPublishItem(baseItem({ status: "draft", startingPrice: -1 }))).toBe(false);
    expect(canPublishItem(baseItem({ status: "open" }))).toBe(false);
  });

  it("canUnpublishItem allows open items without bids only", () => {
    expect(canUnpublishItem(baseItem({ status: "open" }), false)).toBe(true);
    expect(canUnpublishItem(baseItem({ status: "open" }), true)).toBe(false);
    expect(canUnpublishItem(baseItem({ status: "draft" }), false)).toBe(false);
  });

  it("allSelectedPublishable requires every item publishable", () => {
    expect(
      allSelectedPublishable([baseItem({ status: "draft" }), baseItem({ id: "i2", normalizedName: "b" })]),
    ).toBe(true);
    expect(
      allSelectedPublishable([baseItem({ status: "draft" }), baseItem({ id: "i2", status: "open" })]),
    ).toBe(false);
    expect(allSelectedPublishable([])).toBe(false);
  });

  it("allSelectedUnpublishable respects bids map", () => {
    const bids = new Map<string, Bid[]>([
      ["i1", [{ id: "b1", itemId: "i1", uid: "u", bidderName: "A", amount: 1, type: "regular" }]],
    ]);
    expect(allSelectedUnpublishable([baseItem({ status: "open", id: "i1" })], bids)).toBe(false);
    expect(allSelectedUnpublishable([baseItem({ status: "open", id: "i1" })], new Map())).toBe(true);
  });

  it("publishableDraftItems filters valid drafts", () => {
    const items = [
      baseItem({ id: "a", normalizedName: "a", status: "draft" }),
      baseItem({ id: "b", normalizedName: "b", status: "open" }),
      baseItem({ id: "c", normalizedName: "c", status: "draft", startingPrice: -1 }),
    ];
    expect(publishableDraftItems(items)).toHaveLength(1);
    expect(publishableDraftItems(items)[0]?.id).toBe("a");
  });

  it("itemFormWouldBeValid mirrors admin form rules", () => {
    expect(itemFormWouldBeValid({ name: "x", startingPrice: "0", lockInPrice: "1" })).toBe(true);
    expect(itemFormWouldBeValid({ name: "", startingPrice: "0", lockInPrice: "1" })).toBe(false);
    expect(itemFormWouldBeValid({ name: "x", startingPrice: "", lockInPrice: "1" })).toBe(false);
  });
});
