import nodemailer from "nodemailer";

/** SMTP 已配置到「可尝试发信」的最低条件（与 GET /mail/smtp-status 的 likely_ready 一致） */
export function isSmtpLikelyReady(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const port = process.env.SMTP_PORT?.trim();
  const from = process.env.SMTP_FROM?.trim();
  return Boolean(host && port && from);
}

/** 控制台登录页完整 URL；未配置 CONSOLE_WEB_PUBLIC_URL 时返回 null */
export function consoleLoginUrlFromEnv(): string | null {
  const raw = process.env.CONSOLE_WEB_PUBLIC_URL?.trim();
  if (!raw) {
    return null;
  }
  const base = raw.replace(/\/$/, "");
  return `${base}/login`;
}

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendSmtpMail(input: SendMailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSmtpLikelyReady()) {
    return { ok: false, error: "未配置 SMTP_HOST、SMTP_PORT、SMTP_FROM，无法发信" };
  }
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT!.trim()) || 587;
  const from = process.env.SMTP_FROM!.trim();
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim() || undefined;
  const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw === "true" || secureRaw === "1";

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `邮件发送失败：${msg}` };
  }
}
