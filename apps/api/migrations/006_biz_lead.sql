-- 对齐 docs/数据字典-线索.md §3（唯一约束按对接结论后再收紧；此处仅 CHECK）
CREATE TABLE IF NOT EXISTS biz_lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  dy_leads_enterprise_id text NOT NULL,
  account_id text NOT NULL,
  dy_lead_wlz_id text,
  dy_lead_ylz_id text,
  lead_stage text NOT NULL CHECK (lead_stage IN ('no_conversion', 'converted')),
  dy_last_interaction_at timestamptz,
  dy_last_interaction_summary text,
  dy_avatar_url text,
  dy_nickname text,
  dy_unique_id text,
  dy_region text,
  dy_video_id text,
  last_synced_at timestamptz,
  sync_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, platform, account_id)
    REFERENCES biz_account (tenant_id, platform, account_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_lead_tenant_stage ON biz_lead (tenant_id, lead_stage);
CREATE INDEX IF NOT EXISTS idx_biz_lead_tenant_account ON biz_lead (tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_biz_lead_tenant_interaction ON biz_lead (tenant_id, dy_last_interaction_at DESC NULLS LAST);
