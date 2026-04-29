"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth, RecaptchaVerifier } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAuctioneerBuildPlaceholderKey",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "auctioneer.localhost",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "auctioneer-local",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "auctioneer-local.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:auctioneer",
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
// if (
//   process.env.NODE_ENV === "development" &&
//   typeof window !== "undefined" &&
//   ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname)
// ) {
//   auth.settings.appVerificationDisabledForTesting = true;
// }
export const db = getFirestore(firebaseApp);
export { RecaptchaVerifier };
