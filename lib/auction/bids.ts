import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { isWholeDollarBid, maxAllowedBidForItem } from "@/lib/auction/bid-limits";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionGuest, requireUser } from "@/lib/firebase/server-auth";

type BidType = "regular" | "locked";
type MinimumBidField = "startingPrice" | "lockInPrice";

export type BidRequestBody = {
  itemId: string;
  amount: number;
};

export type AuthenticatedBidder = {
  uid: string;
  displayName: string;
};

export async function requireAuthenticatedBidder(request: NextRequest, auctionId: string) {
  const user = await requireUser(request);
  const guestAuctionDoc = await requireAuctionGuest(auctionId, user.uid);

  return {
    uid: user.uid,
    displayName: String(guestAuctionDoc.get("displayName") ?? "Guest"),
  };
}

export function parseBidRequestBody(body: unknown): BidRequestBody {
  const { itemId, amount } = body as { itemId?: unknown; amount?: unknown };
  if (typeof itemId !== "string" || !itemId || typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("Item and bid amount are required.");
  }

  return { itemId, amount };
}

export function parseBidItemRequestBody(body: unknown) {
  const { itemId } = body as { itemId?: unknown };
  if (typeof itemId !== "string" || !itemId) throw new Error("Item is required.");

  return { itemId };
}

export async function requireOpenBidTarget({
  transaction,
  auctionId,
  itemId,
  amount,
  minimumBidField,
  bidLabel,
  unavailableMessage = "Item is not open for bidding.",
}: {
  transaction: Transaction;
  auctionId: string;
  itemId: string;
  amount: number;
  minimumBidField: MinimumBidField;
  bidLabel: string;
  unavailableMessage?: string;
}) {
  if (!isWholeDollarBid(amount)) throw new Error(`${bidLabel}s must be whole dollar amounts.`);

  const auctionRef = adminDb.doc(`auctions/${auctionId}`);
  const itemRef = adminDb.doc(`auctions/${auctionId}/items/${itemId}`);
  const auctionDoc = await transaction.get(auctionRef);
  const itemDoc = await transaction.get(itemRef);

  if (auctionDoc.get("status") !== "open") throw new Error("Bidding is not open for this auction.");
  if (!itemDoc.exists) throw new Error("Item not found.");
  if (itemDoc.get("status") !== "open" || itemDoc.get("winnerUid")) throw new Error(unavailableMessage);

  const minimumBid = Number(itemDoc.get(minimumBidField) ?? 0);
  if (amount < minimumBid) throw new Error(`${bidLabel} does not meet the minimum price.`);

  const maxAllowedBid = maxAllowedBidForItem({
    msrp: Number(itemDoc.get("msrp") ?? 0),
    startingPrice: Number(itemDoc.get("startingPrice") ?? 0),
  });
  if (amount > maxAllowedBid) throw new Error(`Bid seems a little high! It's way over MSRP`);

  return { auctionRef, itemRef, itemDoc };
}

export async function writeBid({
  transaction,
  itemRef,
  auctionId,
  itemId,
  bidder,
  amount,
  type,
  preserveCreatedAt,
}: {
  transaction: Transaction;
  itemRef: DocumentReference;
  auctionId: string;
  itemId: string;
  bidder: AuthenticatedBidder;
  amount: number;
  type: BidType;
  preserveCreatedAt: boolean;
}) {
  const bidRef = itemRef.collection("bids").doc(bidder.uid);
  const existingBid = preserveCreatedAt ? await transaction.get(bidRef) : null;

  transaction.set(
    bidRef,
    {
      auctionId,
      itemId,
      uid: bidder.uid,
      bidderName: bidder.displayName,
      amount,
      type,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existingBid?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
}
