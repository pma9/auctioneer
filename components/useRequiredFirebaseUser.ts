"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/client";

export function useRequiredFirebaseUser(redirectTo = "/") {
  const router = useRouter();
  const [user, setUser] = useState<User | null>();

  useEffect(
    () =>
      onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        if (!nextUser) router.replace(redirectTo);
      }),
    [redirectTo, router],
  );

  return user;
}
