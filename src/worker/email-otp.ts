import { emailOTP } from "better-auth/plugins/email-otp";
import type { AuthEnvironment } from "./auth";

const otpSender = "noreply@vprint.401.moe";

export function createEmailOtpPlugin(env: AuthEnvironment) {
  return emailOTP({
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== "sign-in") {
        throw new Error(`unsupported email OTP type: ${type}`);
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
