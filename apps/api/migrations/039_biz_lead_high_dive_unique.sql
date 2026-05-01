-- 高潜列表入库 biz_lead：按 Tab 主键去重，便于 ON CONFLICT 幂等更新
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_lead_high_dive_wlz
  ON biz_lead (tenant_id, platform, account_id, dy_lead_wlz_id)
  WHERE lead_stage = 'no_conversion' AND dy_lead_wlz_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_lead_high_dive_ylz
  ON biz_lead (tenant_id, platform, account_id, dy_lead_ylz_id)
  WHERE lead_stage = 'converted' AND dy_lead_ylz_id IS NOT NULL;
