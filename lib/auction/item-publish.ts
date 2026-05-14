import type { AuctionItem, Bid } from "@/lib/auction/types";
import { isAuctionItemValid } from "@/lib/auction/item-validation";

export function canPublishItem(item: AuctionItem): boolean {
  if (item.status !== "draft") return false;
  return isAuctionItemValid(item);
}

export function canUnpublishItem(item: AuctionItem, itemHasBids: boolean): boolean {
  if (item.status !== "open") return false;
  if (itemHasBids) return false;
  return true;
}

export function allSelectedPublishable(items: AuctionItem[]): boolean {
  return items.length > 0 && items.every(canPublishItem);
}

export function allSelectedUnpublishable(items: AuctionItem[], bidsByItemId: Map<string, Bid[]>): boolean {
  return (
    items.length > 0 &&
    items.every((item) => canUnpublishItem(item, (bidsByItemId.get(item.id)?.length ?? 0) > 0))
  );
}

export function publishableDraftItems(items: AuctionItem[]): AuctionItem[] {
  return items.filter(canPublishItem);
}

/** Same validation rules as the admin item form (without import-only errors). */
export function itemFormWouldBeValid(fields: {
  name: string;
  startingPrice: string;
  lockInPrice: string;
}): boolean {
  const nameOk = fields.name.trim().length > 0;
  const startOk = isNonnegativeNumberString(fields.startingPrice);
  const lockOk = isNonnegativeNumberString(fields.lockInPrice);
  return nameOk && startOk && lockOk;
}

function isNonnegativeNumberString(value: string) {
  if (!value.trim()) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}
