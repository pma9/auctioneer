"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type SubmittingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isSubmitting?: boolean;
  submittingLabel?: ReactNode;
};

export function SubmittingButton({
  children,
  className,
  disabled,
  isSubmitting = false,
  submittingLabel,
  ...props
}: SubmittingButtonProps) {
  return (
    <button
      {...props}
      aria-busy={isSubmitting || undefined}
      className={[className, isSubmitting ? "animate-pulse" : ""].filter(Boolean).join(" ")}
      disabled={disabled || isSubmitting}
    >
      {isSubmitting ? (submittingLabel ?? children) : children}
    </button>
  );
}
