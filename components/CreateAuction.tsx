"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConfirmationResult, onAuthStateChanged, signInWithPhoneNumber, signOut, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { normalizePhoneNumber, US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import { auth, db, RecaptchaVerifier } from "@/lib/firebase/client";

const DEFAULT_AUCTION_TITLE = "Auction Title";

export function CreateAuction() {
  const router = useRouter();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [title, setTitle] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminDisplayNameDraft, setAdminDisplayNameDraft] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;

    return onSnapshot(doc(db, `users/${user.uid}`), (snapshot) => {
      const displayName = snapshot.exists() ? String(snapshot.get("displayName") ?? "") : "";
      setAdminDisplayName(displayName);
      setAdminDisplayNameDraft(displayName);
    });
  }, [user]);

  useEffect(() => {
    if (!user || !adminDisplayName) return;

    titleInputRef.current?.focus();
  }, [adminDisplayName, user]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    toast.dismiss();
    try {
      const normalizedPhone = normalizePhoneNumber(phone);
      recaptchaRef.current ??= new RecaptchaVerifier(auth, "new-auction-recaptcha", { size: "invisible" });
      const result = await signInWithPhoneNumber(auth, normalizedPhone, recaptchaRef.current);
      setConfirmation(result);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to send verification code.");
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!confirmation) return;
    await confirmation.confirm(code);
    toast("Signed in. You can create an auction now.");
  }

  async function createAuction(event: FormEvent) {
    event.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast("Sign in with phone first.");
      return;
    }
    if (!currentUser.phoneNumber) {
      toast("Admins must sign in with a phone number to create auctions.");
      return;
    }
    const submittedAdminDisplayName = (adminDisplayName || adminDisplayNameDraft).trim();
    if (!submittedAdminDisplayName) {
      toast("Admin name is required.");
      return;
    }
    const auctionTitle = title.trim() || DEFAULT_AUCTION_TITLE;

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/auctions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title: auctionTitle, adminDisplayName: submittedAdminDisplayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setAdminDisplayName(submittedAdminDisplayName);
      const auctionId = result.auctionId as string;
      router.push(`/auctions/${auctionId}/admin`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to create auction.");
    }
  }

  async function logout() {
    await signOut(auth);
    setPhone("");
    setCode("");
    setConfirmation(null);
    toast.dismiss();
    router.replace("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Auctioneer</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-950">Create an auction</h1>
        <p className="mt-3 text-slate-600">Anyone can create an auction. All we need is your phone number.</p>

        {!user ? (
          <div className="mt-6 space-y-4">
            {confirmation ? (
              <form className="space-y-4" onSubmit={verifyCode}>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    className="input"
                    placeholder="SMS code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <button className="button" type="submit">
                    Verify
                  </button>
                  <p className="text-sm text-slate-600">Please enter the code sent to {phone}.</p>
                </div>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={sendCode}>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={US_PHONE_PLACEHOLDER}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
                <button className="button w-full" type="submit">
                  Send sign-in code
                </button>
              </form>
            )}
            <div id="new-auction-recaptcha" />
          </div>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={createAuction}>
            {adminDisplayName ? (
              <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>Logged in as {adminDisplayName}.</span>
                <button className="font-semibold text-slate-950" type="button" onClick={logout}>
                  Logout
                </button>
              </div>
            ) : (
              <>
                <label className="label">Auction admin name</label>
                <input
                  className="input"
                  autoComplete="name"
                  value={adminDisplayNameDraft}
                  onChange={(event) => setAdminDisplayNameDraft(event.target.value)}
                  required
                />
              </>
            )}
            <label className="label">Auction title</label>
            <input
              ref={titleInputRef}
              className="input"
              placeholder={DEFAULT_AUCTION_TITLE}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button className="button w-full" type="submit">
              Create auction
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
