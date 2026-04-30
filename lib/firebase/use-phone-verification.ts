"use client";

import { useCallback, useEffect, useRef } from "react";
import { signInWithPhoneNumber } from "firebase/auth";
import { auth, RecaptchaVerifier } from "@/lib/firebase/client";

export function usePhoneVerification(recaptchaContainerId: string) {
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const resetRecaptcha = useCallback(() => {
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
    if (typeof document === "undefined") return;

    document.getElementById(recaptchaContainerId)?.replaceChildren();
    document.querySelectorAll(".grecaptcha-badge").forEach((badge) => {
      const badgeParent = badge.parentElement;
      if (badgeParent && badgeParent !== document.body && badgeParent.childElementCount === 1) {
        badgeParent.remove();
        return;
      }
      badge.remove();
    });
  }, [recaptchaContainerId]);

  const sendVerificationCode = useCallback(
    async (phoneNumber: string) => {
      try {
        recaptchaRef.current ??= new RecaptchaVerifier(auth, recaptchaContainerId, {
          badge: "inline",
          size: "invisible",
        });
        return await signInWithPhoneNumber(auth, phoneNumber, recaptchaRef.current);
      } catch (error) {
        resetRecaptcha();
        throw error;
      }
    },
    [recaptchaContainerId, resetRecaptcha],
  );

  useEffect(() => resetRecaptcha, [resetRecaptcha]);

  return { sendVerificationCode, resetRecaptcha };
}
