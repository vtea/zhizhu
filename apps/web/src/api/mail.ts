import { getApiBaseUrl } from "@/api/env";
import { apiGetJson } from "@/api/http";

export type SmtpStatusResponse = {
  smtp_host_set: boolean;
  smtp_port_set: boolean;
  smtp_from_set: boolean;
  smtp_user_set: boolean;
  smtp_password_set: boolean;
  /** 主机、端口、发件人地址均已配置（账号密码按部署策略可选） */
  likely_ready: boolean;
};

export async function getSmtpConfigStatus(): Promise<SmtpStatusResponse> {
  return apiGetJson<SmtpStatusResponse>("/api/v1/mail/smtp-status");
}

export function mailStatusAvailable(): boolean {
  return Boolean(getApiBaseUrl());
}
