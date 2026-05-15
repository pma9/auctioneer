import type { AuctionItem, Bid } from "@/lib/auction/types";

type FirestoreItemData = Record<string, unknown> | undefined;

/** Fields that imply a bidder commitment or finalized outcome — must not be present for hard deletes. */
const PROMISE_FIELD_KEYS = [
  "winnerUid",
  "winnerName",
  "winningBid",
  "finalPrice",
  "lockedAt",
  "settledAt",
] as const;

function docHasPromiseFields(data: FirestoreItemData): boolean {
  if (!data) return false;
  for (const key of PROMISE_FIELD_KEYS) {
    if (!(key in data)) continue;
    const v = data[key];
    if (v !== null && v !== undefined) return true;
  }
  return false;
}

export function canHardDeleteItem(item: AuctionItem, itemHasBids: boolean): boolean {
  if (item.status !== "draft" && item.status !== "invalid") return false;
  if (itemHasBids) return false;
  return !itemHasPromiseOutcome(item);
}

function itemHasPromiseOutcome(item: AuctionItem): boolean {
  if (item.winnerUid != null && item.winnerUid !== "") return true;
  if (item.winnerName != null && item.winnerName !== "") return true;
  if (item.winningBid != null) return true;
  if (item.finalPrice != null) return true;
  if (item.lockedAt != null) return true;
  if (item.settledAt != null) return true;
  return false;
}

export function allSelectedHardDeletable(items: AuctionItem[], bidsByItemId: Map<string, Bid[]>): boolean {
  if (items.length === 0) return false;
  return items.every((item) => canHardDeleteItem(item, (bidsByItemId.get(item.id)?.length ?? 0) > 0));
}

/**
 * Validates Firestore document data prior to deleting the item doc (server-side).
 * `hasBidDocuments` comes from querying `items/{itemId}/bids` with limit 1.
 */
export function validateHardDeleteItemDocument(
  data: FirestoreItemData,
  hasBidDocuments: boolean,
): { ok: true } | { ok: false; status: number; error: string } {
  const status = data?.status;
  if (status !== "draft" && status !== "invalid") {
    return {
      ok: false,
      status: 400,
      error: "Only unpublished items can be deleted.",
    };
  }
  if (hasBidDocuments) {
    return {
      ok: false,
      status: 400,
      error: "Items with bids cannot be deleted.",
    };
  }
  if (docHasPromiseFields(data)) {
    return {
      ok: false,
      status: 400,
      error: "Locked or settled items cannot be deleted.",
    };
  }
  return { ok: true };
}
