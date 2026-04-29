import { Suspense } from "react";
import { LoginFlow } from "@/components/LoginFlow";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginFlow />
    </Suspense>
  );
}
