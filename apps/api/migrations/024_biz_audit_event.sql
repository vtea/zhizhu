-- 统一审计事件（登录、改权、导出任务等可写入）
CREATE TABLE IF NOT EXISTS biz_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text,
  actor_sub text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_audit_event_tenant ON biz_audit_event (tenant_id, created_at DESC);
