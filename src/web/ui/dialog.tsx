import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function DialogRoot({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export function DialogContent({
  id,
  title,
  description,
  hideClose = false,
  dismissible = true,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  hideClose?: boolean;
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className="vp-dialog-backdrop fixed inset-0"
        style={{
          zIndex: "var(--z-modal)",
          backgroundColor: "var(--backdrop)",
        }}
      />
      <BaseDialog.Popup
        id={id}
        className={cn(
          "vp-dialog-popup fixed left-1/2 top-1/2 w-[min(440px,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] bg-[var(--surface)] border border-[var(--border)] p-6 text-[var(--text)] outline-none",
          className,
        )}
        style={{
          zIndex: "calc(var(--z-modal) + 1)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
          borderColor: "var(--border)",
          boxShadow: "var(--overlay-shadow)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <BaseDialog.Title className="text-[16px] font-semibold leading-5 text-[var(--text)]">
              {title}
            </BaseDialog.Title>
            {description && (
              <BaseDialog.Description className="mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                {description}
              </BaseDialog.Description>
            )}
          </div>
          {!hideClose && (
            <BaseDialog.Close
              aria-label="关闭"
              disabled={!dismissible}
              className="relative -mr-1.5 -mt-1.5 inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--muted)] hover:text-[var(--text)] vp-hover-surface cursor-pointer disabled:opacity-45 before:absolute before:-inset-1.5"
            >
              <X size={16} aria-hidden="true" />
            </BaseDialog.Close>
          )}
        </div>
        <div className="mt-4">{children}</div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
