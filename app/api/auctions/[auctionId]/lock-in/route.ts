import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionGuest, requireUser } from "@/lib/firebase/server-auth";

const ALREADY_LOCKED_ERROR = "Sorry someone else already locked-in before you!";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    const guestAuctionDoc = await requireAuctionGuest(auctionId, user.uid);
    const guestName = guestAuctionDoc.get("displayName") ?? "Guest";

    const { itemId, amount } = (await request.json()) as {
      itemId?: string;
      amount?: number;
    };
    if (!itemId || !amount)
      return NextResponse.json({ error: "Item and bid amount are required." }, { status: 400 });

    await adminDb.runTransaction(async (transaction) => {
      const auctionRef = adminDb.doc(`auctions/${auctionId}`);
      const itemRef = adminDb.doc(`auctions/${auctionId}/items/${itemId}`);
      const auctionDoc = await transaction.get(auctionRef);
      const itemDoc = await transaction.get(itemRef);
      if (auctionDoc.get("status") !== "open") throw new Error("Bidding is not open for this auction.");
      if (!itemDoc.exists) throw new Error("Item not found.");
      if (itemDoc.get("status") !== "open" || itemDoc.get("winnerUid")) throw new Error(ALREADY_LOCKED_ERROR);
      if (amount < Number(itemDoc.get("lockInPrice") ?? 0))
        throw new Error("Bid does not meet the lock-in price.");

      const bidRef = itemRef.collection("bids").doc(user.uid);
      transaction.set(
        bidRef,
        {
          auctionId,
          itemId,
          uid: user.uid,
          bidderName: guestName,
          amount,
          type: "locked",
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.update(itemRef, {
        status: "locked",
        winnerUid: user.uid,
        winnerName: guestName,
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
