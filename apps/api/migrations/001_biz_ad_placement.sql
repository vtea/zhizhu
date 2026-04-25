-- 与 docs/数据字典-视频投放-示意.md 首版对齐（可后续 ALTER 增补）
CREATE TABLE IF NOT EXISTS biz_ad_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  dy_leads_enterprise_id text,
  account_id text NOT NULL,
  dy_video_id text NOT NULL,
  ad_date date NOT NULL,
  spend_amount numeric(16, 2),
  pre_like_count bigint,
  pre_comment_count bigint,
  pre_favorite_count bigint,
  pre_share_count bigint,
  is_current boolean NOT NULL DEFAULT false,
  placement_status text,
  remind_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_ad_placement_tenant ON biz_ad_placement (tenant_id);
CREATE INDEX IF NOT EXISTS idx_biz_ad_placement_tenant_ad_date ON biz_ad_placement (tenant_id, ad_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_biz_ad_placement_current
  ON biz_ad_placement (tenant_id, account_id, dy_video_id)
  WHERE is_current = true;
