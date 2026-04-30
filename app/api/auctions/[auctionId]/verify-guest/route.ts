import { NextRequest, NextResponse } from "next/server";
import { hashPhoneNumber, normalizePhoneNumber } from "@/lib/auction/phone";
import { adminDb } from "@/lib/firebase/admin";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const { phone } = (await request.json()) as { phone?: string };
    if (!phone) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

    const normalizedPhone = normalizePhoneNumber(phone);
    const phoneHash = hashPhoneNumber(normalizedPhone);
    const guestDoc = await adminDb.doc(`auctions/${auctionId}/verifiedGuests/${phoneHash}`).get();

    if (!guestDoc.exists) {
      return NextResponse.json(
        { error: "This phone number is not on the auction guest list." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      allowed: true,
      normalizedPhone,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to verify guest." },
      { status: 400 },
    );
  }
}
