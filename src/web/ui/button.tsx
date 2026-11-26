import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-ink)] border border-transparent hover:opacity-90",
  secondary:
    "bg-[var(--surface)] text-[var(--text)] border border-[var(--control)] vp-hover-surface",
  ghost:
    "bg-transparent text-[var(--muted)] border border-transparent hover:text-[var(--text)] vp-hover-surface",
  danger:
    "bg-[var(--negative)] text-white border border-transparent hover:opacity-90",
};

export function buttonClassName({
  variant = "secondary",
  compact = false,
  className,
}: {
  variant?: ButtonVariant;
  compact?: boolean;
  className?: string;
} = {}) {
  return cn(
    "vp-btn-press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] font-medium whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed",
    compact
      ? "h-8 px-2.5 text-[13px] max-md:min-h-[44px] max-md:px-3"
      : "h-8 px-3 text-[13px] max-md:min-h-[44px] max-md:px-3.5",
    variantStyles[variant],
    className,
  );
}

export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, "className"> {
  variant?: ButtonVariant;
  compact?: boolean;
  className?: string;
}

export function Button({
  variant = "secondary",
  compact = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      className={buttonClassName({ variant, compact, className })}
      {...props}
    />
  );
}
