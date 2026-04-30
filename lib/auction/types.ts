export type AuctionStatus = "pending" | "open" | "closed";
export type BidType = "regular" | "locked";
export type ItemStatus = "open" | "locked" | "settled" | "removed" | "invalid";

export type Auction = {
  id: string;
  title: string;
  adminDisplayName: string;
  status: AuctionStatus;
  createdBy: string;
  auctionNotes?: string;
  closingNotes?: string;
  createdAt?: unknown;
  openedAt?: unknown;
  closedAt?: unknown;
  reopenedAt?: unknown;
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
  settledAt?: unknown;
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
