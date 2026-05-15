import type { AuctionItem } from "@/lib/auction/types";

/** Converts Firestore Timestamp-like values to epoch ms for comparisons and sorting. */
export function firestoreTimestampToMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    const toMillis = (value as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === "function") return toMillis.call(value);
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = (value as { seconds?: number }).seconds;
    const nanoseconds = (value as { nanoseconds?: number }).nanoseconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      const ns = typeof nanoseconds === "number" && Number.isFinite(nanoseconds) ? nanoseconds : 0;
      return seconds * 1000 + Math.trunc(ns / 1_000_000);
    }
  }
  return null;
}

/** Most recently published first; items without `publishedAt` sort last, then by name/id. */
export function compareItemsByPublishedAtDesc(a: AuctionItem, b: AuctionItem): number {
  const ta = firestoreTimestampToMs(a.publishedAt);
  const tb = firestoreTimestampToMs(b.publishedAt);
  const na = ta ?? Number.NEGATIVE_INFINITY;
  const nb = tb ?? Number.NEGATIVE_INFINITY;
  if (nb !== na) return nb - na;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return a.id.localeCompare(b.id);
}

export function sortItemsByPublishedAtDesc(items: AuctionItem[]): AuctionItem[] {
  return [...items].sort(compareItemsByPublishedAtDesc);
}

/** True when the guest should see the “new items” banner (unseen publish marker). */
export function shouldShowNewItemsNotice(
  latestPublishedAt: unknown,
  notificationDismissedAt: unknown,
): boolean {
  const latestMs = firestoreTimestampToMs(latestPublishedAt);
  if (latestMs == null) return false;
  const dismissedMs = firestoreTimestampToMs(notificationDismissedAt);
  return latestMs > (dismissedMs ?? 0);
}

/**
 * Whether an item card should show the “New” styling for the latest publish wave.
 * Compares `publishedAt` to `Auction.latestItemsPublishedAt` (written when a batch is published).
 * When item writes and the auction marker share one batch commit, timestamps match.
 * A small slack covers legacy publishes where item docs committed moments before `latestItemsPublishedAt`.
 */
const LATEST_PUBLISH_MARKER_SLACK_MS = 500;

export function isItemHighlightedForLatestPublishBatch(
  item: AuctionItem,
  latestPublishedAt: unknown,
): boolean {
  const batchMs = firestoreTimestampToMs(latestPublishedAt);
  if (batchMs == null) return false;
  const itemMs = firestoreTimestampToMs(item.publishedAt);
  if (itemMs == null) return false;
  if (itemMs >= batchMs) return true;
  return batchMs - itemMs <= LATEST_PUBLISH_MARKER_SLACK_MS;
}
