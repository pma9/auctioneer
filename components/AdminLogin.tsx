"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConfirmationResult, onAuthStateChanged, signInWithPhoneNumber, signOut, User } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { normalizePhoneNumber, US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import type { Auction } from "@/lib/auction/types";
import { auth, db, RecaptchaVerifier } from "@/lib/firebase/client";

export function AdminLogin() {
  const router = useRouter();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setAuctions(nextUser ? null : []);
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;

    const unsubProfile = onSnapshot(doc(db, `users/${user.uid}`), (snapshot) => {
      setAdminDisplayName(snapshot.exists() ? String(snapshot.get("displayName") ?? "") : "");
    });

    const createdAuctionsQuery = query(collection(db, "auctions"), where("createdBy", "==", user.uid));
    const unsubAuctions = onSnapshot(
      createdAuctionsQuery,
      (snapshot) => {
        setAuctions(
          snapshot.docs.map((auctionDoc) => ({ id: auctionDoc.id, ...auctionDoc.data() }) as Auction),
        );
      },
      (error) => {
        toast(error.message);
        setAuctions([]);
      },
    );
    return () => {
      unsubProfile();
      unsubAuctions();
    };
  }, [user]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    toast.dismiss();
    try {
      const normalizedPhone = normalizePhoneNumber(phone);
      recaptchaRef.current ??= new RecaptchaVerifier(auth, "admin-login-recaptcha", { size: "invisible" });
      const result = await signInWithPhoneNumber(auth, normalizedPhone, recaptchaRef.current);
      setConfirmation(result);
      setSentPhone(normalizedPhone);
    } catch (error) {
      resetRecaptcha();
      toast(error instanceof Error ? error.message : "Unable to send verification code.");
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!confirmation) return;
    const credential = await confirmation.confirm(code);
    if (!credential.user.phoneNumber) {
      await signOut(auth);
      toast("Admin login requires phone authentication.");
      return;
    }
    toast("Signed in. Choose an auction to manage.");
  }

  async function switchAccount() {
    setAuctions([]);
    setAdminDisplayName("");
    await signOut(auth);
    setConfirmation(null);
    setCode("");
    setPhone("");
    setSentPhone("");
    toast.dismiss();
    resetRecaptcha();
  }

  function resetRecaptcha() {
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Admin Access</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-950">Manage your auctions</h1>
        <p className="mt-3 text-slate-600">
          Sign in with the phone number you used to create auctions, then choose which dashboard to open.
        </p>

        {!user ? (
          !confirmation ? (
            <form className="mt-8 space-y-4" onSubmit={sendCode}>
              <label className="label">Admin phone number</label>
              <input
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={US_PHONE_PLACEHOLDER}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
              <button className="button w-full" type="submit">
                Send admin sign-in code
              </button>
            </form>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={verifyCode}>
              <input
                className="input"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              <button className="button w-full" type="submit">
                Verify phone
              </button>
              <p className="text-sm text-slate-600">Please enter the code sent to {sentPhone || phone}.</p>
            </form>
          )
        ) : (
          <div className="mt-8 space-y-5">
            <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span>Signed in as {adminDisplayName || user.phoneNumber}</span>
              <button className="font-semibold text-slate-950" onClick={switchAccount}>
                Logout
              </button>
            </div>

            <Link className="button inline-flex w-full justify-center" href="/auctions/new">
              Create new auction
            </Link>

            {auctions === null ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Loading your auctions...</p>
            ) : auctions.length ? (
              <div className="space-y-3">
                {auctions.map((auction) => (
                  <button
                    className="w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50"
                    key={auction.id}
                    onClick={() => router.push(`/auctions/${auction.id}/admin`)}
                  >
                    <span className="block text-lg font-bold text-slate-950">{auction.title}</span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {auction.status} · {auction.id}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                No auctions created with this phone yet.{" "}
                <Link className="font-semibold text-slate-950" href="/auctions/new">
                  Create one now.
                </Link>
              </div>
            )}
          </div>
        )}

        <div id="admin-login-recaptcha" />
      </div>
    </div>
  );
}
