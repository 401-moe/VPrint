import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

interface CopyButtonProps {
  value: string;
  label: string;
  iconOnly?: boolean;
}

export function CopyButton({ value, label, iconOnly = false }: CopyButtonProps) {
  const [lastCopy, setLastCopy] = useState<{ value: string } | null>(null);
  const writing = useRef(false);
  const copied = lastCopy?.value === value;

  useEffect(() => {
    if (!lastCopy) return;
    const timer = window.setTimeout(() => setLastCopy(null), 1600);
    return () => window.clearTimeout(timer);
  }, [lastCopy]);

  async function copy() {
    if (writing.current) return;
    writing.current = true;
    try {
      await navigator.clipboard.writeText(value);
      setLastCopy({ value });
    } catch {
      setLastCopy(null);
      toast.error("复制失败，请选中内容后手动复制。");
    } finally {
      writing.current = false;
    }
  }

  return (
    <>
      <Button
        variant={iconOnly ? "ghost" : "secondary"}
        compact
        className={iconOnly ? "w-8 shrink-0 px-0 pointer-coarse:w-11 pointer-coarse:px-0" : "shrink-0"}
        aria-label={label}
        title={iconOnly ? label : undefined}
        disabled={!value}
        onClick={copy}
      >
        <span className="vp-copy-faces" data-copied={copied} aria-hidden="true">
          <span className="vp-copy-idle">
            <Copy size={14} />
            {!iconOnly && label}
          </span>
          <span className="vp-copy-success">
            <Check size={14} />
            {!iconOnly && "复制成功"}
          </span>
        </span>
      </Button>
      <span className="sr-only" role="status">{copied ? "复制成功" : ""}</span>
    </>
  );
}
