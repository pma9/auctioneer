"use client";

import { FormEvent, useRef, useState } from "react";
import { ConfirmationResult, signInWithPhoneNumber } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import { auth, RecaptchaVerifier } from "@/lib/firebase/client";

export function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [auctionId, setAuctionId] = useState(searchParams.get("auctionId") ?? "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [message, setMessage] = useState("");
  const [displayName, setDisplayName] = useState("Guest");

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    const response = await fetch(`/api/auctions/${auctionId}/verify-guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "Phone number is not verified for this auction.");
      return;
    }

    setDisplayName(result.displayName);
    recaptchaRef.current ??= new RecaptchaVerifier(auth, "guest-login-recaptcha", { size: "invisible" });
    const confirmationResult = await signInWithPhoneNumber(
      auth,
      result.normalizedPhone,
      recaptchaRef.current,
    );
    setConfirmation(confirmationResult);
    setMessage(`Code sent. Welcome, ${result.displayName}.`);
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (!confirmation) return;

    const credential = await confirmation.confirm(code);
    const token = await credential.user.getIdToken();
    const response = await fetch(`/api/auctions/${auctionId}/join`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "Could not join auction.");
      return;
    }

    router.push(`/auctions/${auctionId}/guest`);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Guest Access</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-950">Private phone login</h1>
        <p className="mt-3 text-slate-600">
          We verify your phone number against this auction before starting Firebase SMS sign-in, so the guest
          list is never exposed.
        </p>

        {!confirmation ? (
          <form className="mt-8 space-y-4" onSubmit={requestCode}>
            <label className="label">Auction ID</label>
            <input
              className="input"
              value={auctionId}
              onChange={(event) => setAuctionId(event.target.value)}
              required
            />
            <label className="label">Phone number</label>
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
              Verify and send code
            </button>
          </form>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={confirmCode}>
            <p className="text-sm text-slate-600">Enter the code sent to {displayName}.</p>
            <input
              className="input"
              placeholder="SMS code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <button className="button w-full" type="submit">
              Enter auction
            </button>
          </form>
        )}

        <div id="guest-login-recaptcha" />
        {message && <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
      </div>
    </div>
  );
}
