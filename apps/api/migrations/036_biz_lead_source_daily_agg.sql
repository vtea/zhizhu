CREATE TABLE IF NOT EXISTS biz_lead_source_daily_agg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  stat_date date NOT NULL,
  account_id text NOT NULL,
  source_display_name text NOT NULL,
  no_conversion_count int NOT NULL DEFAULT 0 CHECK (no_conversion_count >= 0),
  converted_count int NOT NULL DEFAULT 0 CHECK (converted_count >= 0),
  total_count int NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  matched_by text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, stat_date, account_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_lead_source_daily_agg_tenant_date
  ON biz_lead_source_daily_agg (tenant_id, stat_date DESC);

CREATE INDEX IF NOT EXISTS idx_biz_lead_source_daily_agg_tenant_source
  ON biz_lead_source_daily_agg (tenant_id, source_display_name);
