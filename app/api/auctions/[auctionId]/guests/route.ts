import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
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
        displayName: displayName.trim(),
        normalizedPhone,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionAdmin(auctionId, user);

    const { phoneHash, phone, displayName } = (await request.json()) as {
      phoneHash?: string;
      phone?: string;
      displayName?: string;
    };
    if (!phoneHash || !phone || !displayName) {
      return NextResponse.json(
        { error: "Guest name, phone, and existing guest are required." },
        { status: 400 },
      );
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const nextPhoneHash = hashPhoneNumber(normalizedPhone);
    const existingRef = adminDb.doc(`auctions/${auctionId}/verifiedGuests/${phoneHash}`);
    const nextRef = adminDb.doc(`auctions/${auctionId}/verifiedGuests/${nextPhoneHash}`);
    const existingDoc = await existingRef.get();
    if (!existingDoc.exists) return NextResponse.json({ error: "Guest not found." }, { status: 404 });

    const payload = {
      ...existingDoc.data(),
      phoneHash: nextPhoneHash,
      displayName: displayName.trim(),
      normalizedPhone,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = adminDb.batch();
    batch.set(nextRef, payload, { merge: true });
    if (nextPhoneHash !== phoneHash) {
      batch.delete(existingRef);
      await revokeJoinedAccess(auctionId, phoneHash, batch);
    }
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update guest." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionAdmin(auctionId, user);

    const { phoneHash } = (await request.json()) as { phoneHash?: string };
    if (!phoneHash) return NextResponse.json({ error: "Existing guest is required." }, { status: 400 });

    const batch = adminDb.batch();
    batch.delete(adminDb.doc(`auctions/${auctionId}/verifiedGuests/${phoneHash}`));
    await revokeJoinedAccess(auctionId, phoneHash, batch);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove guest." },
      { status: 400 },
    );
  }
}

async function revokeJoinedAccess(auctionId: string, phoneHash: string, batch: WriteBatch) {
  const usersSnapshot = await adminDb.collection("users").where("phoneHash", "==", phoneHash).get();
  usersSnapshot.docs.forEach((userDoc) => {
    batch.delete(adminDb.doc(`users/${userDoc.id}/auctions/${auctionId}`));
  });
}
