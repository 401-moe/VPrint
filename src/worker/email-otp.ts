import { emailOTP } from "better-auth/plugins/email-otp";
import { APIError } from "better-auth/api";
import type { AuthEnvironment } from "./auth";

const otpSender = "noreply@vprint.ac";

export function createEmailOtpPlugin(env: AuthEnvironment, existingAccountOnly = false) {
  return emailOTP({
    disableSignUp: existingAccountOnly,
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== "sign-in" && type !== "forget-password") {
        throw new Error(`unsupported email OTP type: ${type}`);
      }

      if (!env.EMAIL) {
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: type === "sign-in"
            ? "此环境未启用邮箱验证码，请使用密码登录。"
            : "此环境未启用邮箱验证码，暂时无法通过邮箱重置密码。",
        });
      }
      const purpose = type === "sign-in" ? "登录" : "重置密码";
      await env.EMAIL.send({
        to: email,
        from: otpSender,
        subject: `VPrint ${purpose}验证码`,
        text: `${purpose}验证码：${otp}\n\n验证码 5 分钟内有效。如这不是你发起的操作，请忽略这封邮件。`,
      });
    },
    storeOTP: "hashed",
  });
}
