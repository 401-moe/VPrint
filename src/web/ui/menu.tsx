import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cn } from "./cn";

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuPopup({
  children,
  align = "end",
  sideOffset = 4,
  className,
  ariaLabel,
  finalFocus,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
  ariaLabel?: string;
  finalFocus?: boolean | (() => boolean);
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        sideOffset={sideOffset}
        style={{ zIndex: "var(--z-dropdown)" }}
      >
        <BaseMenu.Popup
          aria-label={ariaLabel}
          finalFocus={finalFocus}
          className={cn(
            "vp-popup-menu min-w-[160px] max-w-[min(280px,calc(100vw-24px))] rounded-[var(--radius-card)] bg-[var(--surface)] border border-[var(--border)] p-1 text-[13px] text-[var(--text)] outline-none",
            className,
          )}
          style={{
            backgroundColor: "var(--surface)",
            color: "var(--text)",
            borderColor: "var(--border)",
            boxShadow: "var(--overlay-shadow)",
          }}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 min-h-[34px] max-md:min-h-[44px] px-2.5 py-1.5 rounded-[var(--radius-control)] cursor-pointer outline-none text-[var(--text)] data-[highlighted]:bg-[var(--raised)]",
        className,
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}
