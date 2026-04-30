import { randomInt } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { hashPhoneNumber } from "@/lib/auction/phone";
import { adminDb } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/firebase/server-auth";

const AUCTION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AUCTION_CODE_LENGTH = 6;
const AUCTION_CODE_RETRIES = 20;

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!user.phone_number) {
      return NextResponse.json(
        { error: "Admins must sign in with a phone number to create auctions." },
        { status: 403 },
      );
    }

    const { title, adminDisplayName } = (await request.json()) as {
      title?: string;
      adminDisplayName?: string;
    };
    if (!title?.trim()) return NextResponse.json({ error: "Auction title is required." }, { status: 400 });
    if (!adminDisplayName?.trim()) {
      return NextResponse.json({ error: "Admin name is required." }, { status: 400 });
    }

    const auctionId = await createAuctionWithShortCode({
      title: title.trim(),
      adminDisplayName: adminDisplayName.trim(),
      uid: user.uid,
      phoneNumber: user.phone_number,
    });

    return NextResponse.json({ auctionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create auction." },
      { status: 400 },
    );
  }
}

async function createAuctionWithShortCode({
  title,
  adminDisplayName,
  uid,
  phoneNumber,
}: {
  title: string;
  adminDisplayName: string;
  uid: string;
  phoneNumber: string;
}) {
  const phoneHash = hashPhoneNumber(phoneNumber);

  for (let attempt = 0; attempt < AUCTION_CODE_RETRIES; attempt++) {
    const auctionId = generateAuctionCode();
    const auctionRef = adminDb.doc(`auctions/${auctionId}`);
    const created = await adminDb.runTransaction(async (transaction) => {
      const existingAuction = await transaction.get(auctionRef);
      if (existingAuction.exists) return false;

      transaction.create(auctionRef, {
        title,
        adminDisplayName,
        status: "pending",
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(adminDb.doc(`auctions/${auctionId}/admins/${uid}`), {
        uid,
        displayName: adminDisplayName,
        phoneHash,
        normalizedPhone: phoneNumber,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        adminDb.doc(`users/${uid}`),
        {
          displayName: adminDisplayName,
          phoneHash,
          normalizedPhone: phoneNumber,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return true;
    });

    if (created) return auctionId;
  }

  throw new Error("Unable to create a unique auction code. Please try again.");
}

function generateAuctionCode() {
  return Array.from(
    { length: AUCTION_CODE_LENGTH },
    () => AUCTION_CODE_ALPHABET[randomInt(AUCTION_CODE_ALPHABET.length)],
  ).join("");
}
