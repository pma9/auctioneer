import { NextRequest, NextResponse } from "next/server";

import { validateHardDeleteItemDocument } from "@/lib/auction/item-delete";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionAdmin, requireUser } from "@/lib/firebase/server-auth";

type RouteContext = {
  params: Promise<{ auctionId: string; itemId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId, itemId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionAdmin(auctionId, user);

    const itemRef = adminDb.doc(`auctions/${auctionId}/items/${itemId}`);
    const [itemSnap, bidsSnap] = await Promise.all([
      itemRef.get(),
      itemRef.collection("bids").limit(1).get(),
    ]);

    if (!itemSnap.exists) {
      return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }

    const data = itemSnap.data() as Record<string, unknown> | undefined;
    const validation = validateHardDeleteItemDocument(data, !bidsSnap.empty);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    await itemRef.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete item." },
      { status: 400 },
    );
  }
}
