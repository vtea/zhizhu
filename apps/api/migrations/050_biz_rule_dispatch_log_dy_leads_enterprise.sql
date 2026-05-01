-- 规则下发日志按「线索主体」收窄列表（组织成员 JWT 范围）；写入侧可选落库便于查询
ALTER TABLE biz_rule_dispatch_log
  ADD COLUMN IF NOT EXISTS dy_leads_enterprise_id text NULL;

CREATE INDEX IF NOT EXISTS idx_biz_rule_dispatch_tenant_ent_created
  ON biz_rule_dispatch_log (tenant_id, dy_leads_enterprise_id, created_at DESC);
