import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { hashPhoneNumber, normalizePhoneNumber } from "@/lib/auction/phone";
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

    const { phone, displayName } = (await request.json()) as { phone?: string; displayName?: string };
    if (!phone || !displayName)
      return NextResponse.json({ error: "Guest name and phone are required." }, { status: 400 });

    const normalizedPhone = normalizePhoneNumber(phone);
    const phoneHash = hashPhoneNumber(normalizedPhone);
    await adminDb.doc(`auctions/${auctionId}/verifiedGuests/${phoneHash}`).set(
      {
        phoneHash,
        displayName,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add guest." },
      { status: 400 },
    );
  }
}
