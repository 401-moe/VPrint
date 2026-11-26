import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

const BASE_INPUT_CLASS =
  "h-9 w-full rounded-[var(--radius-control)] border border-[var(--control)] bg-[var(--input-bg)] px-3 text-[16px] md:text-[14px] text-[var(--text)] placeholder:text-[var(--faint)] disabled:opacity-60 max-md:min-h-[44px]";

/**
 * Input for non-identity entity fields (team names, contest names, device codes).
 * Suppresses password-manager autofill overlays.
 */
export const Input = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(function Input({ className, type = "text", ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      data-protonpass-ignore="true"
      data-bwignore="true"
      data-form-type="other"
      className={cn(BASE_INPUT_CLASS, className)}
      {...props}
    />
  );
});

/**
 * Input for login, registration, OTP, and password forms so autofill works normally.
 */
export const CredentialInput = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(function CredentialInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(BASE_INPUT_CLASS, className)}
      {...props}
    />
  );
});
