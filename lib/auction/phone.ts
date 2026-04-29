import { createHash } from "node:crypto";
import { normalizePhoneNumber } from "@/lib/auction/phone-normalization";

export { normalizePhoneNumber };

export function hashPhoneNumber(phone: string) {
  const pepper = process.env.PHONE_HASH_PEPPER ?? "";
  return createHash("sha256")
    .update(`${pepper}:${normalizePhoneNumber(phone)}`)
    .digest("hex");
}
