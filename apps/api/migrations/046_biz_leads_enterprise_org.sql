-- 企业主体登记 + 部门/成员挂接；biz_account .dy_leads_enterprise_id 指向登记表
CREATE TABLE IF NOT EXISTS biz_leads_enterprise (
  tenant_id text NOT NULL,
  dy_leads_enterprise_id text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dy_leads_enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_leads_ent_tenant_status
  ON biz_leads_enterprise (tenant_id, status);

CREATE TABLE IF NOT EXISTS biz_org_unit_leads_enterprise (
  tenant_id text NOT NULL,
  org_unit_id uuid NOT NULL,
  dy_leads_enterprise_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_unit_id, dy_leads_enterprise_id),
  CONSTRAINT fk_ou_le_org_unit FOREIGN KEY (org_unit_id) REFERENCES biz_org_unit (id) ON DELETE CASCADE,
  CONSTRAINT fk_ou_le_enterprise FOREIGN KEY (tenant_id, dy_leads_enterprise_id)
    REFERENCES biz_leads_enterprise (tenant_id, dy_leads_enterprise_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ou_le_unit ON biz_org_unit_leads_enterprise (tenant_id, org_unit_id);

CREATE TABLE IF NOT EXISTS biz_org_member_leads_enterprise (
  tenant_id text NOT NULL,
  org_member_id uuid NOT NULL,
  dy_leads_enterprise_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_member_id, dy_leads_enterprise_id),
  CONSTRAINT fk_om_le_member FOREIGN KEY (org_member_id) REFERENCES biz_org_member (id) ON DELETE CASCADE,
  CONSTRAINT fk_om_le_enterprise FOREIGN KEY (tenant_id, dy_leads_enterprise_id)
    REFERENCES biz_leads_enterprise (tenant_id, dy_leads_enterprise_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_om_le_member ON biz_org_member_leads_enterprise (tenant_id, org_member_id);

INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
SELECT DISTINCT tenant_id,
       dy_leads_enterprise_id,
       COALESCE(MAX(dy_leads_enterprise_name), dy_leads_enterprise_id)::text AS display_name,
       'active',
       now()
FROM biz_account
WHERE dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id) <> ''
GROUP BY tenant_id, dy_leads_enterprise_id
ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING;

INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
SELECT DISTINCT tenant_id, dy_leads_enterprise_id, dy_leads_enterprise_id, 'active', now()
FROM biz_lead
WHERE dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id) <> ''
GROUP BY tenant_id, dy_leads_enterprise_id
ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING;

INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
SELECT DISTINCT tenant_id, dy_leads_enterprise_id, dy_leads_enterprise_id, 'active', now()
FROM biz_video
WHERE dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id) <> ''
GROUP BY tenant_id, dy_leads_enterprise_id
ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING;

INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
SELECT DISTINCT tenant_id, dy_leads_enterprise_id, dy_leads_enterprise_id, 'active', now()
FROM biz_task
WHERE dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id) <> ''
GROUP BY tenant_id, dy_leads_enterprise_id
ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING;

INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
SELECT DISTINCT tenant_id, dy_leads_enterprise_id, dy_leads_enterprise_id, 'active', now()
FROM biz_ad_placement
WHERE dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id) <> ''
GROUP BY tenant_id, dy_leads_enterprise_id
ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING;

-- 回填后：关联任意未登记过的 ID（历史脏数据兜底）
ALTER TABLE biz_account
  DROP CONSTRAINT IF EXISTS fk_biz_account_leads_enterprise;

ALTER TABLE biz_account
  ADD CONSTRAINT fk_biz_account_leads_enterprise FOREIGN KEY (tenant_id, dy_leads_enterprise_id)
    REFERENCES biz_leads_enterprise (tenant_id, dy_leads_enterprise_id)
    ON DELETE RESTRICT
    NOT VALID;

-- 仅当 dy_leads_enterprise_id 非空时 FK 生效（PostgreSQL FK 默认允许 NULL）

UPDATE biz_leads_enterprise e
SET display_name = COALESCE(NULLIF(trim(e.display_name), ''), e.dy_leads_enterprise_id)
WHERE display_name IS NULL OR btrim(display_name) = '';

ALTER TABLE biz_account VALIDATE CONSTRAINT fk_biz_account_leads_enterprise;

INSERT INTO biz_org_unit_leads_enterprise (tenant_id, org_unit_id, dy_leads_enterprise_id)
SELECT u.tenant_id, u.id, 'ent-001'
FROM biz_org_unit u
WHERE u.tenant_id = 'demo'
  AND EXISTS (
    SELECT 1 FROM biz_leads_enterprise e
    WHERE e.tenant_id = 'demo' AND e.dy_leads_enterprise_id = 'ent-001'
  )
ON CONFLICT (tenant_id, org_unit_id, dy_leads_enterprise_id) DO NOTHING;

