import { NextRequest, NextResponse } from "next/server";
import {
  parseBidItemRequestBody,
  parseBidRequestBody,
  requireAuthenticatedBidder,
  requireOpenBidTarget,
  writeBid,
} from "@/lib/auction/bids";
import { adminDb } from "@/lib/firebase/admin";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const bidder = await requireAuthenticatedBidder(request, auctionId);
    const { itemId, amount } = parseBidRequestBody(await request.json());

    await adminDb.runTransaction(async (transaction) => {
      const { itemRef } = await requireOpenBidTarget({
        transaction,
        auctionId,
        itemId,
        amount,
        minimumBidField: "startingPrice",
        bidLabel: "Bid",
      });

      await writeBid({
        transaction,
        itemRef,
        auctionId,
        itemId,
        bidder,
        amount,
        type: "regular",
        preserveCreatedAt: true,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save bid." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const bidder = await requireAuthenticatedBidder(request, auctionId);
    const { itemId } = parseBidItemRequestBody(await request.json());

    await adminDb.runTransaction(async (transaction) => {
      const auctionRef = adminDb.doc(`auctions/${auctionId}`);
      const bidRef = adminDb.doc(`auctions/${auctionId}/items/${itemId}/bids/${bidder.uid}`);
      const auctionDoc = await transaction.get(auctionRef);
      const bidDoc = await transaction.get(bidRef);

      if (auctionDoc.get("status") !== "open") throw new Error("Bidding is not open for this auction.");
      if (!bidDoc.exists) throw new Error("Bid not found.");
      if (bidDoc.get("type") !== "regular") throw new Error("Locked-in bids cannot be removed.");

      transaction.delete(bidRef);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove bid." },
      { status: 400 },
    );
  }
}
