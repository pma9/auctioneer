import { NextRequest } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "./admin";

export async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("Missing Firebase ID token.");
  return adminAuth.verifyIdToken(token);
}

export function requirePhoneUser(user: DecodedIdToken) {
  if (!user.phone_number) throw new Error("Phone-authenticated user required.");
}

export async function requireAuctionAdmin(auctionId: string, user: DecodedIdToken) {
  requirePhoneUser(user);
  const adminDoc = await adminDb.doc(`auctions/${auctionId}/admins/${user.uid}`).get();
  if (!adminDoc.exists) throw new Error("Auction admin access required.");
}

export async function requireAuctionGuest(auctionId: string, uid: string) {
  const userAuctionDoc = await adminDb.doc(`users/${uid}/auctions/${auctionId}`).get();
  if (!userAuctionDoc.exists) throw new Error("Auction guest access required.");
  return userAuctionDoc;
}
