const authMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确。",
  INVALID_PASSWORD: "当前密码不正确。",
  INVALID_OTP: "验证码不正确，请重新输入。",
  OTP_EXPIRED: "验证码已过期，请重新获取。",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册，请直接登录。",
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}, fallback = "请求失败，请稍后重试。"): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new Error("网络异常，请稍后重试。", { cause });
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(response.status, authMessages[result?.code] || result?.message || result?.error || fallback);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
