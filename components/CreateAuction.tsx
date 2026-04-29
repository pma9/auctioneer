"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConfirmationResult, onAuthStateChanged, signInWithPhoneNumber, User } from "firebase/auth";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { normalizePhoneNumber, US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import { auth, db, RecaptchaVerifier } from "@/lib/firebase/client";

export function CreateAuction() {
  const router = useRouter();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [title, setTitle] = useState("Auctioneer Demo Auction");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function sendCode() {
    setMessage("");
    try {
      const normalizedPhone = normalizePhoneNumber(phone);
      recaptchaRef.current ??= new RecaptchaVerifier(auth, "new-auction-recaptcha", { size: "invisible" });
      const result = await signInWithPhoneNumber(auth, normalizedPhone, recaptchaRef.current);
      setConfirmation(result);
      setMessage("Verification code sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send verification code.");
    }
  }

  async function verifyCode() {
    if (!confirmation) return;
    await confirmation.confirm(code);
    setMessage("Signed in. You can create an auction now.");
  }

  async function createAuction(event: FormEvent) {
    event.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setMessage("Sign in with phone first.");
      return;
    }
    if (!currentUser.phoneNumber) {
      setMessage("Admins must sign in with a phone number to create auctions.");
      return;
    }

    const auctionRef = doc(collection(db, "auctions"));
    await setDoc(auctionRef, {
      title,
      status: "active",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, `auctions/${auctionRef.id}/admins/${currentUser.uid}`), {
      uid: currentUser.uid,
      displayName: currentUser.phoneNumber ?? "Auction admin",
      createdAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, `users/${currentUser.uid}`),
      { displayName: currentUser.phoneNumber ?? "Auction admin", updatedAt: serverTimestamp() },
      { merge: true },
    );
    router.push(`/auctions/${auctionRef.id}/admin`);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Auctioneer</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-950">Create an auction</h1>
        <p className="mt-3 text-slate-600">
          Anyone can create an auction. Admin access is scoped to the auction you create.
        </p>

        {!user ? (
          <div className="mt-8 space-y-4">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={US_PHONE_PLACEHOLDER}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            {confirmation ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  className="input"
                  placeholder="SMS code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button className="button" onClick={verifyCode}>
                  Verify
                </button>
              </div>
            ) : (
              <button className="button w-full" onClick={sendCode}>
                Send admin sign-in code
              </button>
            )}
            <div id="new-auction-recaptcha" />
          </div>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={createAuction}>
            <label className="label">Auction title</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
            <button className="button w-full" type="submit">
              Create auction
            </button>
          </form>
        )}

        {message && <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
      </div>
    </div>
  );
}
