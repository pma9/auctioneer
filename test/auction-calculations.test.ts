import { describe, expect, it } from "vitest";
import {
  calculateFinancialSummary,
  calculateVickreyBreakdown,
  normalizeItemName,
} from "@/lib/auction/calculations";
import type { AuctionItem, Bid } from "@/lib/auction/types";

const item: AuctionItem = {
  id: "item-1",
  name: "Signed Jersey",
  normalizedName: "signed jersey",
  notes: "",
  msrp: 200,
  startingPrice: 50,
  lockInPrice: 300,
  status: "open",
};

function bid(id: string, amount: number, updatedAt: number): Bid {
  return {
    id,
    itemId: item.id,
    uid: id,
    bidderName: id,
    amount,
    type: "regular",
    updatedAt,
  };
}

describe("auction calculations", () => {
  it("charges starting price when there is only one regular bid", () => {
    const breakdown = calculateVickreyBreakdown(item, [bid("alice", 100, 1)]);

    expect(breakdown.topBid?.uid).toBe("alice");
    expect(breakdown.finalPrice).toBe(50);
  });

  it("charges the second highest bid when multiple bids exist", () => {
    const breakdown = calculateVickreyBreakdown(item, [
      bid("alice", 100, 1),
      bid("bob", 175, 2),
      bid("cora", 125, 3),
    ]);

    expect(breakdown.topBid?.uid).toBe("bob");
    expect(breakdown.secondBid?.uid).toBe("cora");
    expect(breakdown.finalPrice).toBe(125);
  });

  it("uses earliest timestamp to break ties", () => {
    const breakdown = calculateVickreyBreakdown(item, [bid("alice", 100, 2), bid("bob", 100, 1)]);

    expect(breakdown.topBid?.uid).toBe("bob");
  });

  it("calculates max commitment and minimum due", () => {
    const summary = calculateFinancialSummary(
      [item],
      [bid("alice", 100, 1), { ...bid("bob", 350, 2), type: "locked" }],
    );

    expect(summary.totalMaxCommitment).toBe(450);
    expect(summary.minimumDue).toBe(400);
  });

  it("normalizes names for sheet upserts", () => {
    expect(normalizeItemName("  Signed   Jersey ")).toBe("signed jersey");
  });
});
