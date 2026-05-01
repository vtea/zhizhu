-- 演示数据补齐：把高潜（rule-high-potential）抓到的 12 个员工号建档进 biz_account，
-- 让 ingestBizLeadHighDiveRows 的 matchBizAccountBySourceDisplayName / matchBizAccountByDyUniqueId
-- 能命中 referName / referUid，从而把 biz_lead 真正写进库。
--
-- 字段约定：
--   * account_id          : 用 referUid（抖音用户 uid，租户内唯一）
--   * dy_display_name     : referName 原文（含全角括号；matcher 会同时按 normalize 与 normalizeCore 命中）
--   * dy_unique_id        : referUid（与 account_id 一致；冗余保留方便人眼对账）
--   * dy_leads_enterprise_id : ent-001（沿用 020 演示主体；高潜抓的就是这家的客资）
--   * account_kind        : enterprise_staff（企业员工号）
--
-- 重放策略：
--   * 用 (tenant_id, platform, account_id) UNIQUE 的 ON CONFLICT 直接 upsert；
--   * 不动 020 已有的 east_official / wang_auth 两条；
--   * id 用固定 UUID（前缀 b0000001-…-0000-1101..1112），与 020 规约一致。

INSERT INTO biz_account (
  id, tenant_id, platform, account_id, account_kind,
  dy_leads_enterprise_id, dy_leads_enterprise_name,
  dy_display_name, dy_unique_id, ops_status, auth_status
) VALUES
  ('b0000001-0000-4000-8000-000000001101'::uuid, 'demo', 'douyin', '104387699496',         'enterprise_staff', 'ent-001', '示例企业主体 A', '北京导游-七七',                    '104387699496',         'running', 'active'),
  ('b0000001-0000-4000-8000-000000001102'::uuid, 'demo', 'douyin', '344602714574572',      'enterprise_staff', 'ent-001', '示例企业主体 A', '苏杭领队大江（✉️领线路资料报价）', '344602714574572',      'running', 'active'),
  ('b0000001-0000-4000-8000-000000001103'::uuid, 'demo', 'douyin', '7572764171106075685',  'enterprise_staff', 'ent-001', '示例企业主体 A', '北京旅导大伟（📩领路线资料报价）', '7572764171106075685',  'running', 'active'),
  ('b0000001-0000-4000-8000-000000001104'::uuid, 'demo', 'douyin', '1920219536698428',     'enterprise_staff', 'ent-001', '示例企业主体 A', '嘉成国际',                          '1920219536698428',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001105'::uuid, 'demo', 'douyin', '1505656538669420',     'enterprise_staff', 'ent-001', '示例企业主体 A', '北京导游盈盈',                      '1505656538669420',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001106'::uuid, 'demo', 'douyin', '833909088592697',      'enterprise_staff', 'ent-001', '示例企业主体 A', '北京小团领队-玲玲',                 '833909088592697',      'running', 'active'),
  ('b0000001-0000-4000-8000-000000001107'::uuid, 'demo', 'douyin', '3379228732828243',     'enterprise_staff', 'ent-001', '示例企业主体 A', '北京领队丽丽',                      '3379228732828243',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001108'::uuid, 'demo', 'douyin', '1400106291309977',     'enterprise_staff', 'ent-001', '示例企业主体 A', '苏杭导游-君君',                     '1400106291309977',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001109'::uuid, 'demo', 'douyin', '4390777219196267',     'enterprise_staff', 'ent-001', '示例企业主体 A', '西安导游-多多',                     '4390777219196267',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001110'::uuid, 'demo', 'douyin', '1927859153935460',     'enterprise_staff', 'ent-001', '示例企业主体 A', '北京导游珊珊',                      '1927859153935460',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001111'::uuid, 'demo', 'douyin', '4250036483437643',     'enterprise_staff', 'ent-001', '示例企业主体 A', '苏杭导游苏苏',                      '4250036483437643',     'running', 'active'),
  ('b0000001-0000-4000-8000-000000001112'::uuid, 'demo', 'douyin', '63090901921396',       'enterprise_staff', 'ent-001', '示例企业主体 A', '北京领队-小覃',                     '63090901921396',       'running', 'active')
ON CONFLICT (tenant_id, platform, account_id) DO UPDATE SET
  account_kind             = EXCLUDED.account_kind,
  dy_leads_enterprise_id   = COALESCE(EXCLUDED.dy_leads_enterprise_id, biz_account.dy_leads_enterprise_id),
  dy_leads_enterprise_name = COALESCE(EXCLUDED.dy_leads_enterprise_name, biz_account.dy_leads_enterprise_name),
  dy_display_name          = COALESCE(EXCLUDED.dy_display_name, biz_account.dy_display_name),
  dy_unique_id             = COALESCE(EXCLUDED.dy_unique_id, biz_account.dy_unique_id),
  ops_status               = COALESCE(EXCLUDED.ops_status, biz_account.ops_status),
  auth_status              = COALESCE(EXCLUDED.auth_status, biz_account.auth_status),
  updated_at               = now();
