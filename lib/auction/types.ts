export type AuctionStatus = "pending" | "open" | "settling" | "closed";
export type BidType = "regular" | "locked";
export type ItemStatus = "draft" | "open" | "locked" | "settled" | "removed" | "invalid";

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
  settlingAt?: unknown;
  closedAt?: unknown;
  reopenedAt?: unknown;
  startsAt?: unknown;
  closesAt?: unknown;
  /** Server timestamp; bumped when one or more items are published (draft → open). */
  latestItemsPublishedAt?: unknown;
};

export type AuctionItem = {
  id: string;
  name: string;
  normalizedName: string;
  notes: string;
  keywords?: string;
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
  /** Set when the item is published (status becomes open). */
  publishedAt?: unknown;
  settledAt?: unknown;
  lockedAt?: unknown;
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
  phoneLast4: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  joinedUid?: string;
  joinedUids?: string[];
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

/** `users/{uid}/auctions/{auctionId}` — guest membership; server also writes on join. */
export type UserAuctionMembership = {
  auctionId?: string;
  role?: string;
  displayName?: string;
  phoneHash?: string;
  phoneLast4?: string;
  joinedAt?: unknown;
  updatedAt?: unknown;
  /** When the guest last dismissed the “new items” notice; compare to `Auction.latestItemsPublishedAt`. */
  newItemsNotificationDismissedAt?: unknown;
};
