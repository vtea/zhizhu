/** 与数据字典字段对齐的演示数据（tenant 维度用 slug 便于阅读） */

export const MOCK_TENANT = "demo";

export type LeadStage = "no_conversion" | "converted";

export type MockLead = {
  id: string;
  tenant_id: string;
  platform: "douyin";
  dy_leads_enterprise_id: string;
  account_id: string;
  dy_lead_id: string;
  /** API 列表会返回；mock 行亦带阶段 */
  lead_stage: LeadStage;
  dy_avatar_url: string | null;
  dy_nickname: string | null;
  dy_unique_id: string | null;
  dy_region: string | null;
  dy_intent_level: string | null;
  dy_last_interaction_at: string | null;
  /** PG 上云：来源视频、账号展示名（见数据字典-线索） */
  dy_video_id?: string | null;
  account_display_name?: string | null;
};

export type MockVideo = {
  id: string;
  tenant_id: string;
  platform: "douyin";
  dy_leads_enterprise_id: string;
  account_id: string;
  dy_video_id: string;
  dy_title: string | null;
  dy_cover_url: string | null;
  dy_duration_sec: number | null;
  dy_publish_at: string | null;
  dy_play_count: number | null;
  dy_like_count: number | null;
  dy_comment_count: number | null;
  dy_favorite_count: number | null;
  dy_share_count: number | null;
  dy_completion_rate: number | null;
  dy_lead_count: number | null;
  metric_synced_at: string | null;
  /** PG：员工账号展示名 */
  account_display_name?: string | null;
};

export type MockAccount = {
  id: string;
  tenant_id: string;
  platform: "douyin";
  account_id: string;
  account_kind: "enterprise_staff" | "personal_authorized";
  dy_leads_enterprise_id: string;
  dy_leads_enterprise_name: string | null;
  dy_nickname: string | null;
  dy_unique_id: string | null;
  ops_status: "running" | "paused";
  remark?: string | null;
};

/** 线索版浏览器里登录态健康（由客户端探测上报，见 `数据字典-任务与设备.md` §3.2） */
export type BrowserSessionHealth = "healthy" | "stale" | "logged_out" | "unknown";

/** 某台设备上已注册的一条「浏览器 profile ↔ 抖音业务账号」 */
export type MockDeviceBrowserAccount = {
  browser_profile_slug: string;
  account_id: string;
  /** 演示用；正式环境可取 `biz_account` 展示名 */
  account_display: string;
  session_health: BrowserSessionHealth;
  last_session_check_at: string | null;
  last_session_good_at: string | null;
  /** 客户端计划探测间隔（分钟），供控制台展示 */
  check_interval_minutes: number;
  session_check_error_code: string | null;
};

export type MockDevice = {
  device_id: string;
  tenant_id: string;
  label: string;
  online: boolean;
  last_seen_at: string | null;
  /** 本机已配置、并向云端上报过的浏览器账号（可多行） */
  browser_accounts: MockDeviceBrowserAccount[];
};

export type MockRule = {
  rule_id: string;
  tenant_id: string;
  name: string;
  status: "draft" | "published";
  version: string;
  updated_at: string;
};

const mockLeadsCore: MockLead[] = [
  {
    id: "l1",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7312345678901234567",
    dy_lead_id: "lead-10001",
    lead_stage: "no_conversion",
    dy_avatar_url: null,
    dy_nickname: "示例用户甲",
    dy_unique_id: "user_alpha",
    dy_region: "上海",
    dy_intent_level: "高",
    dy_last_interaction_at: "2026-04-22T10:15:00.000Z",
  },
  {
    id: "l2",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7312345678901234567",
    dy_lead_id: "lead-10002",
    lead_stage: "converted",
    dy_avatar_url: null,
    dy_nickname: "示例用户乙",
    dy_unique_id: "user_beta",
    dy_region: "浙江",
    dy_intent_level: "中",
    dy_last_interaction_at: "2026-04-21T08:40:00.000Z",
  },
  {
    id: "l3",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7319988776655443322",
    dy_lead_id: "lead-10003",
    lead_stage: "no_conversion",
    dy_avatar_url: null,
    dy_nickname: "示例用户丙",
    dy_unique_id: "user_gamma",
    dy_region: "广东",
    dy_intent_level: "低",
    dy_last_interaction_at: "2026-04-20T16:05:00.000Z",
  },
];

const extraMockLeads: MockLead[] = Array.from({ length: 21 }, (_, i) => {
  const idx = i + 4;
  const converted = i % 5 === 0;
  return {
    id: `l-gen-${i}`,
    tenant_id: MOCK_TENANT,
    platform: "douyin" as const,
    dy_leads_enterprise_id: "ent-001",
    account_id: i % 2 === 0 ? "7312345678901234567" : "7319988776655443322",
    dy_lead_id: `lead-gen-${11000 + i}`,
    lead_stage: converted ? ("converted" as const) : ("no_conversion" as const),
    dy_avatar_url: null,
    dy_nickname: `批量线索 ${idx}`,
    dy_unique_id: `user_gen_${idx}`,
    dy_region: (["江苏", "北京", "四川", "湖北"] as const)[i % 4],
    dy_intent_level: (["高", "中", "低"] as const)[i % 3],
    dy_last_interaction_at: new Date(Date.UTC(2026, 3, 10 + (i % 10), 8, 0)).toISOString(),
  };
});

export const mockLeads: MockLead[] = [...mockLeadsCore, ...extraMockLeads];

export const mockVideos: MockVideo[] = [
  {
    id: "v1",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7312345678901234567",
    dy_video_id: "vid-90001",
    dy_title: "春季新品一分钟讲透",
    dy_cover_url: null,
    dy_duration_sec: 62,
    dy_publish_at: "2026-04-18T12:00:00.000Z",
    dy_play_count: 128_000,
    dy_like_count: 3200,
    dy_comment_count: 210,
    dy_favorite_count: 980,
    dy_share_count: 120,
    dy_completion_rate: 0.18,
    dy_lead_count: 12,
    metric_synced_at: "2026-04-23T06:00:00.000Z",
  },
  {
    id: "v2",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7312345678901234567",
    dy_video_id: "vid-90002",
    dy_title: "门店探店：周末客流复盘",
    dy_cover_url: null,
    dy_duration_sec: 45,
    dy_publish_at: "2026-04-10T09:30:00.000Z",
    dy_play_count: 45_000,
    dy_like_count: 900,
    dy_comment_count: 88,
    dy_favorite_count: 320,
    dy_share_count: 40,
    dy_completion_rate: 0.22,
    dy_lead_count: 5,
    metric_synced_at: "2026-04-23T06:00:00.000Z",
  },
  {
    id: "v3",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    dy_leads_enterprise_id: "ent-001",
    account_id: "7319988776655443322",
    dy_video_id: "vid-90003",
    dy_title: "矩阵账号冷启动记录",
    dy_cover_url: null,
    dy_duration_sec: 38,
    dy_publish_at: "2026-04-05T14:20:00.000Z",
    dy_play_count: 9800,
    dy_like_count: 260,
    dy_comment_count: 42,
    dy_favorite_count: 110,
    dy_share_count: 18,
    dy_completion_rate: 0.15,
    dy_lead_count: 2,
    metric_synced_at: "2026-04-23T06:00:00.000Z",
  },
];

export const mockAccounts: MockAccount[] = [
  {
    id: "a1",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    account_id: "7312345678901234567",
    account_kind: "enterprise_staff",
    dy_leads_enterprise_id: "ent-001",
    dy_leads_enterprise_name: "示例企业主体 A",
    dy_nickname: "企业号·华东",
    dy_unique_id: "east_official",
    ops_status: "running",
  },
  {
    id: "a2",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    account_id: "7319988776655443322",
    account_kind: "personal_authorized",
    dy_leads_enterprise_id: "ent-001",
    dy_leads_enterprise_name: "示例企业主体 A",
    dy_nickname: "个人授权·小王",
    dy_unique_id: "wang_auth",
    ops_status: "running",
  },
];

export const mockDevices: MockDevice[] = [
  {
    device_id: "dev-mac-001",
    tenant_id: MOCK_TENANT,
    label: "设计部 · MacBook",
    online: true,
    last_seen_at: "2026-04-23T17:20:00.000Z",
    browser_accounts: [
      {
        browser_profile_slug: "jiacheng-guoji",
        account_id: "7312345678901234567",
        account_display: "企业号·华东",
        session_health: "healthy",
        last_session_check_at: "2026-04-23T17:18:00.000Z",
        last_session_good_at: "2026-04-23T17:18:00.000Z",
        check_interval_minutes: 10,
        session_check_error_code: null,
      },
      {
        browser_profile_slug: "wang-personal",
        account_id: "7319988776655443322",
        account_display: "个人授权·小王",
        session_health: "stale",
        last_session_check_at: "2026-04-23T15:40:00.000Z",
        last_session_good_at: "2026-04-23T15:40:00.000Z",
        check_interval_minutes: 10,
        session_check_error_code: null,
      },
    ],
  },
  {
    device_id: "dev-win-002",
    tenant_id: MOCK_TENANT,
    label: "销售一部 · Windows",
    online: false,
    last_seen_at: "2026-04-22T22:10:00.000Z",
    browser_accounts: [
      {
        browser_profile_slug: "sales-east",
        account_id: "7312345678901234567",
        account_display: "企业号·华东",
        session_health: "logged_out",
        last_session_check_at: "2026-04-22T21:50:00.000Z",
        last_session_good_at: "2026-04-22T09:00:00.000Z",
        check_interval_minutes: 15,
        session_check_error_code: "LOGIN_WALL",
      },
    ],
  },
];

export const mockRules: MockRule[] = [
  {
    rule_id: "rule-high-potential",
    tenant_id: MOCK_TENANT,
    name: "高潜用户列表（官方模板）",
    status: "published",
    version: "2026.04.1",
    updated_at: "2026-04-20T11:00:00.000Z",
  },
  {
    rule_id: "rule-analytics",
    tenant_id: MOCK_TENANT,
    name: "数据分析概览同步",
    status: "draft",
    version: "2026.04.0",
    updated_at: "2026-04-18T09:30:00.000Z",
  },
];
