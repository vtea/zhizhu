-- 对齐 docs/数据字典-员工账号.md §7 粒度 B（账户级指标快照）
CREATE TABLE IF NOT EXISTS biz_account_metric_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL,
  account_id text NOT NULL,
  stat_date date,
  synced_at timestamptz,
  dy_follower_count bigint,
  dy_video_count int,
  dy_total_likes bigint,
  dy_total_favorites bigint,
  dy_total_comments bigint,
  dy_total_shares bigint,
  dy_ad_spend_total numeric(16, 2),
  dy_ad_new_followers bigint,
  dy_ad_campaign_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, platform, account_id)
    REFERENCES biz_account (tenant_id, platform, account_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_biz_acct_metric_tenant_acct
  ON biz_account_metric_snapshot (tenant_id, platform, account_id, stat_date DESC);
