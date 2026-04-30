import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { calculateVickreyBreakdown } from "@/lib/auction/calculations";
import type { AuctionItem, Bid } from "@/lib/auction/types";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionAdmin, requireUser } from "@/lib/firebase/server-auth";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionAdmin(auctionId, user);

    const auctionRef = adminDb.doc(`auctions/${auctionId}`);
    await adminDb.runTransaction(async (transaction) => {
      const auctionDoc = await transaction.get(auctionRef);
      if (!auctionDoc.exists) throw new Error("Auction not found.");
      if (auctionDoc.get("status") !== "open") throw new Error("Only open auctions can be closed out.");

      transaction.update(auctionRef, {
        status: "settling",
        settlingAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    try {
      const itemsSnapshot = await adminDb
        .collection(`auctions/${auctionId}/items`)
        .where("status", "==", "open")
        .get();
      const batch = adminDb.batch();

      for (const itemDoc of itemsSnapshot.docs) {
        const item = { id: itemDoc.id, ...itemDoc.data() } as AuctionItem;
        const bidsSnapshot = await itemDoc.ref.collection("bids").where("type", "==", "regular").get();
        const bids = bidsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Bid);
        const breakdown = calculateVickreyBreakdown(item, bids);
        if (!breakdown.topBid) continue;

        batch.update(itemDoc.ref, {
          status: "settled",
          winnerUid: breakdown.topBid.uid,
          winnerName: breakdown.topBid.bidderName,
          winningBid: breakdown.topBid.amount,
          finalPrice: breakdown.finalPrice,
          settledAt: FieldValue.serverTimestamp(),
        });
      }

      batch.update(auctionRef, {
        status: "closed",
        settlingAt: FieldValue.delete(),
        closedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      await auctionRef.update({
        status: "open",
        settlingAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to settle auction." },
      { status: 400 },
    );
  }
}
