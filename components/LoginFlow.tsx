"use client";

import { FormEvent, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RecaptchaLegalNotice } from "@/components/RecaptchaLegalNotice";
import { SubmittingButton } from "@/components/SubmittingButton";
import { US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import { usePhoneVerification } from "@/lib/firebase/use-phone-verification";

export function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sendVerificationCode, resetRecaptcha } = usePhoneVerification("guest-login-recaptcha");
  const [auctionId, setAuctionId] = useState(searchParams.get("auctionId") ?? "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [smsRecipientPhone, setSmsRecipientPhone] = useState("");
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isConfirmingCode, setIsConfirmingCode] = useState(false);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    if (isRequestingCode) return;
    toast.dismiss();

    setIsRequestingCode(true);
    try {
      const response = await fetch(`/api/auctions/${auctionId}/verify-guest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const result = await response.json();
      if (!response.ok) {
        toast(result.error ?? "Phone number is not verified for this auction.");
        return;
      }

      setSmsRecipientPhone(result.normalizedPhone);
      const confirmationResult = await sendVerificationCode(result.normalizedPhone);
      setConfirmation(confirmationResult);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to send verification code.");
    } finally {
      setIsRequestingCode(false);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (isConfirmingCode) return;
    if (!confirmation) return;

    setIsConfirmingCode(true);
    try {
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
        toast(result.error ?? "Could not join auction.");
        return;
      }

      resetRecaptcha();
      router.replace(`/auctions/${auctionId}/guest`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not join auction.");
    } finally {
      setIsConfirmingCode(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Auctioneer</p>
        <h1 className="mt-3 text-4xl font-bold text-slate-950">Guest login</h1>
        <p className="mt-3 text-slate-600">
          If you&apos;ve been added as a guest to an auction, you can sign in with the auction ID and your
          phone number.
        </p>

        {!confirmation ? (
          <form className="mt-6 space-y-4" onSubmit={requestCode}>
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
            <SubmittingButton
              className="button w-full"
              isSubmitting={isRequestingCode}
              submittingLabel="Sending..."
              type="submit"
            >
              Verify and send code
            </SubmittingButton>
            <RecaptchaLegalNotice />
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={confirmCode}>
            <input
              className="input"
              placeholder="SMS code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <p className="text-sm text-slate-600">Enter the code sent to {smsRecipientPhone}.</p>
            <SubmittingButton
              className="button w-full"
              isSubmitting={isConfirmingCode}
              submittingLabel="Entering..."
              type="submit"
            >
              Enter auction
            </SubmittingButton>
          </form>
        )}

        <div id="guest-login-recaptcha" />
      </div>
    </div>
  );
}
