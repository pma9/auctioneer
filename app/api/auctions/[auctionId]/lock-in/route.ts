import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  parseBidRequestBody,
  requireAuthenticatedBidder,
  requireOpenBidTarget,
  writeBid,
} from "@/lib/auction/bids";
import { adminDb } from "@/lib/firebase/admin";

const ALREADY_LOCKED_ERROR = "Sorry someone else already locked-in before you!";

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
        minimumBidField: "lockInPrice",
        bidLabel: "Lock-in bid",
        unavailableMessage: ALREADY_LOCKED_ERROR,
      });

      await writeBid({
        transaction,
        itemRef,
        auctionId,
        itemId,
        bidder,
        amount,
        type: "locked",
        preserveCreatedAt: false,
      });
      transaction.update(itemRef, {
        status: "locked",
        winnerUid: bidder.uid,
        winnerName: bidder.displayName,
        winningBid: amount,
        finalPrice: amount,
        lockedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to lock in item." },
      { status: 400 },
    );
  }
}
