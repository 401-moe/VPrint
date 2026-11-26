import { useEffect, useState } from "react";
import { api } from "./api";
import { BreadcrumbHeader } from "./Shell";
import { Button } from "./ui/button";

interface Choice {
  login: string;
  email: string | null;
  canCreate: boolean;
  returnPath: string;
}

export async function openGithub(returnPath: string) {
  const result = await api<{ url: string }>(
    "/api/auth/github/start",
    {
      method: "POST",
      body: JSON.stringify({ callbackURL: returnPath }),
    },
    "暂时无法使用 GitHub 登录。",
  );
  window.location.assign(result.url);
}

export function GithubChoice({ member }: { member: { email: string } | null }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("occupied")) {
      setError("该 GitHub 身份已绑定其他 VPrint 账号。");
      return;
    }
    const controller = new AbortController();
    api<Choice>("/api/auth/github/choice", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setChoice(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("GitHub 授权已失效，请重新登录。");
      });
    return () => controller.abort();
  }, []);

  async function decide(action: "bind" | "cancel" | "create") {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ returnPath: string }>(
        "/api/auth/github/decision",
        {
          method: "POST",
          body: JSON.stringify({ action }),
        },
        "操作失败，请重试。",
      );
      window.location.replace(data.returnPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BreadcrumbHeader />
      <main className="mx-auto max-w-[460px] px-4 py-10">
        <header className="mb-5">
          <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] leading-[1.25] text-[var(--text)]">
            确认 GitHub 账号
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            使用这个 GitHub 身份继续登录 VPrint。
          </p>
        </header>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 space-y-4">
          {choice ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--ground)] px-3.5 py-2.5 text-[13px]">
                <strong className="font-semibold text-[var(--text)]">
                  {choice.login}
                </strong>
                <span className="text-[var(--muted)]">
                  {choice.email ?? "GitHub 未返回已验证邮箱"}
                </span>
              </div>

              <div className="space-y-2.5">
                {choice.email ? (
                  <>
                    {choice.canCreate && (
                      <Button
                        variant="primary"
                        className="h-9 w-full"
                        disabled={busy}
                        onClick={() => void decide("create")}
                      >
                        以此邮箱创建新账号
                      </Button>
                    )}
                    {member ? (
                      <Button
                        variant="secondary"
                        className="h-9 w-full"
                        disabled={busy}
                        onClick={() => void decide("bind")}
                      >
                        确认绑定到 {member.email}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="h-9 w-full"
                        disabled={busy}
                        onClick={() => location.replace("/github/choice?bind=1")}
                      >
                        绑定已有账号
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[13px] text-[var(--muted)]">
                      请先在 GitHub 验证邮箱，然后重新授权；或改用 VPrint 邮箱验证码。
                    </p>
                    <Button
                      variant="primary"
                      className="h-9 w-full"
                      disabled={busy}
                      onClick={() =>
                        void openGithub(choice.returnPath).catch(() =>
                          setError("无法重新授权。"),
                        )
                      }
                    >
                      重新验证 GitHub
                    </Button>
                    <a
                      className="inline-flex h-9 w-full items-center justify-center rounded-[var(--radius-control)] border border-[var(--control)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text)] vp-hover-surface"
                      href={`/login?method=otp&next=${encodeURIComponent(choice.returnPath)}`}
                    >
                      使用邮箱验证码
                    </a>
                  </div>
                )}

                <Button
                  variant="ghost"
                  className="h-9 w-full"
                  disabled={busy}
                  onClick={() => void decide("cancel")}
                >
                  取消
                </Button>
              </div>
            </>
          ) : (
            <p
              className={`text-[13px] ${error ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}
              role={error ? "alert" : "status"}
            >
              {error || "正在读取 GitHub 授权结果…"}
            </p>
          )}

          {choice && error && (
            <p className="text-[13px] text-[var(--negative)]" role="alert">
              {error}
            </p>
          )}

          {!choice && error && (
            <a
              className="inline-block text-[13px] font-medium text-[var(--accent)] hover:underline"
              href="/login"
            >
              返回登录
            </a>
          )}
        </section>
      </main>
    </>
  );
}
