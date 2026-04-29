export type AuctionStatus = "draft" | "active" | "closed";
export type BidType = "regular" | "locked";
export type ItemStatus = "open" | "locked" | "settled" | "removed" | "invalid";

export type Auction = {
  id: string;
  title: string;
  status: AuctionStatus;
  createdBy: string;
  createdAt?: unknown;
  startsAt?: unknown;
  closesAt?: unknown;
};

export type AuctionItem = {
  id: string;
  name: string;
  normalizedName: string;
  notes: string;
  msrp: number;
  startingPrice: number;
  lockInPrice: number;
  status: ItemStatus;
  winnerUid?: string;
  winnerName?: string;
  winningBid?: number;
  finalPrice?: number;
  sourceSheetId?: string;
  sourceRow?: number;
  importValidationErrors?: string[];
  updatedAt?: unknown;
  createdAt?: unknown;
};

export type Bid = {
  id: string;
  itemId: string;
  uid: string;
  bidderName: string;
  amount: number;
  type: BidType;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type VerifiedGuest = {
  phoneHash: string;
  displayName: string;
  normalizedPhone?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  joinedUid?: string;
};

export type ItemBidBreakdown = {
  item: AuctionItem;
  topBid?: Bid;
  secondBid?: Bid;
  finalPrice: number;
  revenue: number;
};

export type FinancialSummary = {
  totalMaxCommitment: number;
  minimumDue: number;
};
