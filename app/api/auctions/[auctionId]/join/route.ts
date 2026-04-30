import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getPhoneLast4, hashPhoneNumber } from "@/lib/auction/phone";
import { adminDb } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/firebase/server-auth";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    if (!user.phone_number) {
      return NextResponse.json({ error: "Phone-authenticated user required." }, { status: 403 });
    }

    const phoneHash = hashPhoneNumber(user.phone_number);
    const phoneLast4 = getPhoneLast4(user.phone_number);
    const guestDoc = await adminDb.doc(`auctions/${auctionId}/verifiedGuests/${phoneHash}`).get();
    if (!guestDoc.exists) {
      return NextResponse.json(
        { error: "This phone number is not on the auction guest list." },
        { status: 403 },
      );
    }

    const displayName = guestDoc.get("displayName") ?? "Guest";
    const batch = adminDb.batch();
    batch.set(
      adminDb.doc(`users/${user.uid}`),
      {
        phoneHash,
        phoneLast4,
        displayName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      adminDb.doc(`users/${user.uid}/auctions/${auctionId}`),
      {
        auctionId,
        role: "guest",
        phoneHash,
        phoneLast4,
        displayName,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      guestDoc.ref,
      {
        joinedUid: user.uid,
        joinedUids: FieldValue.arrayUnion(user.uid),
        phoneLast4,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();

    return NextResponse.json({ ok: true, displayName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to join auction." },
      { status: 401 },
    );
  }
}
