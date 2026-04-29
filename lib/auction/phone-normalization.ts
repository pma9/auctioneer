export const US_PHONE_PLACEHOLDER = "(555) 555-0123";

export function normalizePhoneNumber(rawPhone: string) {
  const digits = rawPhone.replace(/\D/g, "");
  const nationalNumber = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (nationalNumber.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber)) {
    return `+1${nationalNumber}`;
  }

  throw new Error("Enter a valid US phone number.");
}
