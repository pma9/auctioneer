import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionGuest, requireUser } from "@/lib/firebase/server-auth";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionGuest(auctionId, user.uid);

    const { itemId, amount, bidderName } = (await request.json()) as {
      itemId?: string;
      amount?: number;
      bidderName?: string;
    };
    if (!itemId || !amount)
      return NextResponse.json({ error: "Item and bid amount are required." }, { status: 400 });

    await adminDb.runTransaction(async (transaction) => {
      const itemRef = adminDb.doc(`auctions/${auctionId}/items/${itemId}`);
      const itemDoc = await transaction.get(itemRef);
      if (!itemDoc.exists) throw new Error("Item not found.");
      if (itemDoc.get("status") !== "open" || itemDoc.get("winnerUid"))
        throw new Error("Item is already closed.");
      if (amount < Number(itemDoc.get("lockInPrice") ?? 0))
        throw new Error("Bid does not meet the lock-in price.");

      const bidRef = itemRef.collection("bids").doc(user.uid);
      transaction.set(
        bidRef,
        {
          auctionId,
          itemId,
          uid: user.uid,
          bidderName: bidderName || user.name || "Guest",
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
        winnerName: bidderName || user.name || "Guest",
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
