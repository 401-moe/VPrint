import { emailOTP } from "better-auth/plugins/email-otp";
import { APIError } from "better-auth/api";
import type { AuthEnvironment } from "./auth";

const otpSender = "noreply@vprint.401.moe";

export function createEmailOtpPlugin(env: AuthEnvironment, existingAccountOnly = false) {
  return emailOTP({
    disableSignUp: existingAccountOnly,
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== "sign-in") {
        throw new Error(`unsupported email OTP type: ${type}`);
      }

      if (!env.EMAIL) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: "此环境未启用邮箱验证码，请使用密码登录。" });
      }
      await env.EMAIL.send({
        to: email,
        from: otpSender,
        subject: "VPrint 登录验证码",
        text: `登录验证码：${otp}\n\n验证码 5 分钟内有效。`,
      });
    },
    storeOTP: "hashed",
  });
}
