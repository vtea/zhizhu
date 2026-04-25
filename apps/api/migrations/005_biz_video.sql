-- 对齐 docs/数据字典-视频.md §3
CREATE TABLE IF NOT EXISTS biz_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  dy_leads_enterprise_id text NOT NULL,
  account_id text NOT NULL,
  dy_video_id text NOT NULL,
  dy_title text,
  dy_cover_url text,
  dy_duration_sec int,
  dy_publish_at timestamptz,
  dy_play_count bigint,
  dy_like_count bigint,
  dy_comment_count bigint,
  dy_favorite_count bigint,
  dy_share_count bigint,
  dy_completion_rate numeric(8, 6),
  dy_lead_count int,
  metric_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, platform, account_id)
    REFERENCES biz_account (tenant_id, platform, account_id),
  UNIQUE (tenant_id, platform, dy_video_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_video_tenant ON biz_video (tenant_id);
CREATE INDEX IF NOT EXISTS idx_biz_video_tenant_account ON biz_video (tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_biz_video_tenant_publish ON biz_video (tenant_id, dy_publish_at DESC NULLS LAST);
