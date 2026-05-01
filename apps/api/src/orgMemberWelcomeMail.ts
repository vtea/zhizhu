import { consoleLoginUrlFromEnv, isSmtpLikelyReady, sendSmtpMail } from "./smtpSend.js";

export type OrgMemberWelcomeMailInput = {
  to: string;
  tenantDisplayName: string;
  loginUsername: string;
  plainPassword: string;
};

export function validateWelcomeMailPrerequisites(): { ok: true } | { ok: false; error: string } {
  if (!isSmtpLikelyReady()) {
    return { ok: false, error: "未配置可用的 SMTP（须设置 SMTP_HOST、SMTP_PORT、SMTP_FROM），无法发送邮件" };
  }
  const loginUrl = consoleLoginUrlFromEnv();
  if (!loginUrl) {
    return { ok: false, error: "未配置 CONSOLE_WEB_PUBLIC_URL（控制台公开访问根地址），无法生成登录链接" };
  }
  return { ok: true };
}

export async function sendOrgMemberConsoleWelcomeMail(
  input: OrgMemberWelcomeMailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pre = validateWelcomeMailPrerequisites();
  if (!pre.ok) {
    return pre;
  }
  const loginUrl = consoleLoginUrlFromEnv()!;
  const text = [
    `您好，`,
    ``,
    `管理员已为您开通控制台登录，请使用下列信息登录：`,
    ``,
    `登录地址：${loginUrl}`,
    `租户名称：${input.tenantDisplayName}`,
    `登录名：${input.loginUsername}`,
    `登录密码：${input.plainPassword}`,
    ``,
    `请首次登录后尽快修改密码，并勿转发此邮件。`,
  ].join("\n");

  return sendSmtpMail({
    to: input.to,
    subject: `【知竹】控制台登录信息 — ${input.tenantDisplayName}`,
    text,
  });
}
