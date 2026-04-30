import { createHash } from "node:crypto";
import { normalizePhoneNumber } from "@/lib/auction/phone-normalization";

export { normalizePhoneNumber };

function getPhoneHashPepper() {
  const pepper = process.env.PHONE_HASH_PEPPER;
  if (!pepper?.trim()) {
    throw new Error("PHONE_HASH_PEPPER must be set before hashing phone numbers.");
  }

  return pepper;
}

export function hashPhoneNumber(phone: string) {
  const pepper = getPhoneHashPepper();
  return createHash("sha256")
    .update(`${pepper}:${normalizePhoneNumber(phone)}`)
    .digest("hex");
}
