import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function RenameForm({ kind, id, name, onRenamed }: {
  kind: "team" | "contest";
  id: string;
  name: string;
  onRenamed: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = kind === "team" ? "队伍名称" : "比赛名称";
  const value = draft ?? name;
  const changed = value.trim() !== "" && value.trim() !== name;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api<{ name: string }>(`/api/${kind}s/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: value.trim() }),
      });
      onRenamed(saved.name);
      setDraft(current => current === value ? null : current);
      toast.success(`已保存${label}「${saved.name}」`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `保存${label}失败。`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3">
      <div className="flex items-center gap-2.5">
        <label htmlFor={`${kind}-name-field`} className="sr-only">{label}</label>
        <Input
          id={`${kind}-name-field`}
          name={`${kind}_title`}
          maxLength={100}
          value={value}
          onChange={event => setDraft(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={saving || !changed}>
          {saving ? "保存中…" : "保存名称"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] text-[var(--negative)]">{error}</p>}
    </form>
  );
}
