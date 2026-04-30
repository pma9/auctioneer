export type BidLimitItem = {
  msrp: number;
  startingPrice: number;
};

export function maxAllowedBidForItem(item: BidLimitItem) {
  const maxAllowedBid = item.msrp > 0 ? item.msrp : item.startingPrice * 10;
  return Math.floor(maxAllowedBid);
}

export function isWholeDollarBid(amount: number) {
  return Number.isFinite(amount) && Number.isInteger(amount);
}
