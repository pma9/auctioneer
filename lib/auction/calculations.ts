import type { AuctionItem, Bid, FinancialSummary, ItemBidBreakdown } from "./types";

export function normalizeItemName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function sortBidsForAuction(bids: Bid[]) {
  return [...bids].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;

    const aTime = timestampMillis(a.updatedAt ?? a.createdAt);
    const bTime = timestampMillis(b.updatedAt ?? b.createdAt);
    return aTime - bTime;
  });
}

export function calculateVickreyBreakdown(item: AuctionItem, bids: Bid[]): ItemBidBreakdown {
  const sorted = sortBidsForAuction(bids);
  const topBid = sorted[0];
  const secondBid = sorted[1];

  if (item.status === "locked" && item.winningBid) {
    return {
      item,
      topBid,
      secondBid,
      finalPrice: item.winningBid,
      revenue: item.winningBid,
    };
  }

  if (!topBid) {
    return { item, finalPrice: 0, revenue: 0 };
  }

  const finalPrice = secondBid ? secondBid.amount : item.startingPrice;
  return {
    item,
    topBid,
    secondBid,
    finalPrice,
    revenue: finalPrice,
  };
}

export function calculateFinancialSummary(items: AuctionItem[], bids: Bid[]): FinancialSummary {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return bids.reduce<FinancialSummary>(
    (summary, bid) => {
      const item = itemsById.get(bid.itemId);
      summary.totalMaxCommitment += bid.amount;

      if (bid.type === "locked") {
        summary.minimumDue += bid.amount;
      } else if (item) {
        summary.minimumDue += item.startingPrice;
      }

      return summary;
    },
    { totalMaxCommitment: 0, minimumDue: 0 },
  );
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function timestampMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}
