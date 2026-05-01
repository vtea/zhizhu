-- Electron 壳同步的 Playwright 持久目录元数据（与 biz_device_browser_account 业务账号登记独立）
CREATE TABLE IF NOT EXISTS biz_device_playwright_shell_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  device_id text NOT NULL,
  client_profile_id uuid NOT NULL,
  browser_profile_slug text NOT NULL,
  display_label text NOT NULL,
  default_start_path text,
  last_opened_at_client timestamptz,
  is_default_profile boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pw_shell_device FOREIGN KEY (tenant_id, device_id)
    REFERENCES biz_device (tenant_id, device_id) ON DELETE CASCADE,
  CONSTRAINT uq_pw_shell_client UNIQUE (tenant_id, device_id, client_profile_id),
  CONSTRAINT uq_pw_shell_slug UNIQUE (tenant_id, device_id, browser_profile_slug),
  CONSTRAINT chk_pw_shell_slug_len CHECK (length(browser_profile_slug) BETWEEN 2 AND 63),
  CONSTRAINT chk_pw_shell_label_len CHECK (length(display_label) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_pw_shell_tenant_dev ON biz_device_playwright_shell_profile (tenant_id, device_id);
