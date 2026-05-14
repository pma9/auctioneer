import type { AuctionItem } from "@/lib/auction/types";

/** Visible to guests in Firestore rules and catalog queries. */
export const GUEST_VISIBLE_ITEM_STATUSES = ["open", "locked", "settled"] as const;

export type GuestVisibleItemStatus = (typeof GUEST_VISIBLE_ITEM_STATUSES)[number];

export function isGuestVisibleItemStatus(status: unknown): status is GuestVisibleItemStatus {
  return typeof status === "string" && (GUEST_VISIBLE_ITEM_STATUSES as readonly string[]).includes(status);
}

export function auctionItemValidationErrors(item: AuctionItem): string[] {
  if (item.importValidationErrors?.length) return item.importValidationErrors;

  const errors: string[] = [];
  if (!item.name.trim()) errors.push("Item name is missing.");
  if (!Number.isFinite(item.startingPrice) || item.startingPrice < 0) {
    errors.push("Starting price is missing or is not a valid non-negative number.");
  }
  if (!Number.isFinite(item.lockInPrice) || item.lockInPrice < 0) {
    errors.push("Lock-in price is missing or is not a valid non-negative number.");
  }
  return errors;
}

export function isAuctionItemValid(item: AuctionItem): boolean {
  return auctionItemValidationErrors(item).length === 0;
}
