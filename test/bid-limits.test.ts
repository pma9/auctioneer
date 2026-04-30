import { describe, expect, it } from "vitest";
import { isWholeDollarBid, maxAllowedBidForItem } from "@/lib/auction/bid-limits";

describe("bid limits", () => {
  it("caps bids at MSRP when MSRP is set", () => {
    expect(maxAllowedBidForItem({ msrp: 200, startingPrice: 50 })).toBe(200);
  });

  it("caps bids at ten times starting price when MSRP is zero", () => {
    expect(maxAllowedBidForItem({ msrp: 0, startingPrice: 50 })).toBe(500);
  });

  it("uses whole-dollar caps when prices include cents", () => {
    expect(maxAllowedBidForItem({ msrp: 10.99, startingPrice: 5 })).toBe(10);
  });

  it("accepts finite whole dollar bids", () => {
    expect(isWholeDollarBid(100)).toBe(true);
    expect(isWholeDollarBid(0)).toBe(true);
  });

  it("rejects cents and non-finite bid amounts", () => {
    expect(isWholeDollarBid(100.5)).toBe(false);
    expect(isWholeDollarBid(Number.NaN)).toBe(false);
    expect(isWholeDollarBid(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
