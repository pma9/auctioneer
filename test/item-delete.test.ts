import { describe, expect, it } from "vitest";
import {
  allSelectedHardDeletable,
  canHardDeleteItem,
  validateHardDeleteItemDocument,
} from "@/lib/auction/item-delete";
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

describe("item-delete helpers", () => {
  it("canHardDeleteItem allows draft/invalid without bids or promise fields", () => {
    expect(canHardDeleteItem(baseItem({ status: "draft" }), false)).toBe(true);
    expect(canHardDeleteItem(baseItem({ status: "invalid" }), false)).toBe(true);
  });

  it("canHardDeleteItem rejects non-draft/invalid statuses", () => {
    expect(canHardDeleteItem(baseItem({ status: "open" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ status: "locked" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ status: "settled" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ status: "removed" }), false)).toBe(false);
  });

  it("canHardDeleteItem rejects when bids exist", () => {
    expect(canHardDeleteItem(baseItem({ status: "draft" }), true)).toBe(false);
  });

  it("canHardDeleteItem rejects when promise/outcome fields are set", () => {
    expect(canHardDeleteItem(baseItem({ winnerUid: "u1" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ winnerName: "A" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ winningBid: 42 }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ finalPrice: 42 }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ lockedAt: "ts" }), false)).toBe(false);
    expect(canHardDeleteItem(baseItem({ settledAt: "ts" }), false)).toBe(false);
  });

  it("allSelectedHardDeletable requires every selection to pass", () => {
    const bids = new Map<string, Bid[]>([
      ["i1", [{ id: "b1", itemId: "i1", uid: "u", bidderName: "A", amount: 1, type: "regular" }]],
    ]);
    expect(
      allSelectedHardDeletable(
        [baseItem({ status: "draft", id: "i1" }), baseItem({ id: "i2", normalizedName: "x" })],
        bids,
      ),
    ).toBe(false);
    expect(allSelectedHardDeletable([baseItem({ id: "i2", normalizedName: "x" })], bids)).toBe(true);
    expect(allSelectedHardDeletable([], bids)).toBe(false);
  });

  it("validateHardDeleteItemDocument mirrors server constraints", () => {
    expect(validateHardDeleteItemDocument(undefined, false).ok).toBe(false);
    expect(
      validateHardDeleteItemDocument({ status: "draft", name: "x" } as Record<string, unknown>, true).ok,
    ).toBe(false);
    expect(
      validateHardDeleteItemDocument({ status: "draft", winnerUid: "x" } as Record<string, unknown>, false)
        .ok,
    ).toBe(false);
    expect(validateHardDeleteItemDocument({ status: "draft" }, false)).toEqual({ ok: true });
  });
});
