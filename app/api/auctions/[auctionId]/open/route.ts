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

    const auctionRef = adminDb.doc(`auctions/${auctionId}`);
    const auctionDoc = await auctionRef.get();
    if (!auctionDoc.exists) throw new Error("Auction not found.");
    if (auctionDoc.get("status") !== "pending") throw new Error("Only pending auctions can be opened.");

    await auctionRef.update({
      status: "open",
      openedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to open auction." },
      { status: 400 },
    );
  }
}
