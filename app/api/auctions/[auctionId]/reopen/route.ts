import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
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

    const settledItemsSnapshot = await adminDb
      .collection(`auctions/${auctionId}/items`)
      .where("status", "==", "settled")
      .get();
    const batch = adminDb.batch();

    for (const itemDoc of settledItemsSnapshot.docs) {
      batch.update(itemDoc.ref, {
        status: "open",
        winnerUid: FieldValue.delete(),
        winnerName: FieldValue.delete(),
        winningBid: FieldValue.delete(),
        finalPrice: FieldValue.delete(),
        settledAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    batch.update(adminDb.doc(`auctions/${auctionId}`), {
      status: "active",
      closedAt: FieldValue.delete(),
      reopenedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to re-open auction." },
      { status: 400 },
    );
  }
}
