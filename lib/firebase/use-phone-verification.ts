"use client";

import { useCallback, useEffect, useRef } from "react";
import { signInWithPhoneNumber } from "firebase/auth";
import { auth, RecaptchaVerifier } from "@/lib/firebase/client";

export function usePhoneVerification(recaptchaContainerId: string) {
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const resetRecaptcha = useCallback(() => {
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
  }, []);

  const sendVerificationCode = useCallback(
    async (phoneNumber: string) => {
      try {
        recaptchaRef.current ??= new RecaptchaVerifier(auth, recaptchaContainerId, { size: "invisible" });
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
