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
  dy_nickname: string | null;
  dy_unique_id: string | null;
  dy_region?: string | null;
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
  /** 视频页 / v.douyin.com 短链等，与封面图分列 */
  dy_video_url: string | null;
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
  dy_user_url?: string | null;
  ops_status: "running" | "paused" | "revoked";
  remark?: string | null;
};

/** 与 `tenantApi.listAccounts` 中 ops_status 的 CASE 语义一致，供下拉与筛选 */
export function normalizeBizAccountOpsStatusUi(raw: unknown): "running" | "paused" | "revoked" {
  if (raw === "paused" || raw === "revoked" || raw === "running") {
    return raw;
  }
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "paused") return "paused";
    if (s === "revoked") return "revoked";
  }
  return "running";
}

/** 与 API `active_ops_only`：可参与离线新建视频、投放、同步任务等 */
export function accountEligibleForOpsBinding(a: { ops_status?: unknown }): boolean {
  return normalizeBizAccountOpsStatusUi(a.ops_status) === "running";
}

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

/** Electron 客户端「Playwright 浏览器」页同步上报的 Chromium 持久配置（独立于业务抖音账号登记表） */
export type MockDevicePlaywrightShellProfile = {
  client_profile_id: string;
  browser_profile_slug: string;
  display_label: string;
  default_start_path: string | null;
  last_opened_at_client: string | null;
  is_default_profile: boolean;
  synced_at: string | null;
};

export type MockDevice = {
  device_id: string;
  tenant_id: string;
  label: string;
  online: boolean;
  last_seen_at: string | null;
  /** 本机已配置、并向云端上报过的浏览器账号（可多行） */
  browser_accounts: MockDeviceBrowserAccount[];
  /** Electron 客户端「Playwright 浏览器」页同步至云端的持久目录摘要 */
  playwright_shell_profiles: MockDevicePlaywrightShellProfile[];
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
    dy_nickname: "示例用户甲",
    dy_unique_id: "user_alpha",
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
    dy_nickname: "示例用户乙",
    dy_unique_id: "user_beta",
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
    dy_nickname: "示例用户丙",
    dy_unique_id: "user_gamma",
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
    dy_nickname: `批量线索 ${idx}`,
    dy_unique_id: `user_gen_${idx}`,
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
    dy_video_url: null,
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
    dy_video_url: null,
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
    dy_video_url: null,
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
    dy_user_url: "https://www.douyin.com/user/mock-east-official",
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
    dy_user_url: "https://www.douyin.com/user/mock-wang-auth",
    ops_status: "running",
  },
  {
    id: "a3",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    account_id: "7310000000000000001",
    account_kind: "enterprise_staff",
    dy_leads_enterprise_id: "ent-001",
    dy_leads_enterprise_name: "示例企业主体 A",
    dy_nickname: "演示·已暂停",
    dy_unique_id: "paused_demo",
    dy_user_url: null,
    ops_status: "paused",
  },
  {
    id: "a4",
    tenant_id: MOCK_TENANT,
    platform: "douyin",
    account_id: "7310000000000000002",
    account_kind: "enterprise_staff",
    dy_leads_enterprise_id: "ent-001",
    dy_leads_enterprise_name: "示例企业主体 A",
    dy_nickname: "演示·已撤销",
    dy_unique_id: "revoked_demo",
    dy_user_url: null,
    ops_status: "revoked",
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
    playwright_shell_profiles: [
      {
        client_profile_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        browser_profile_slug: "demo-local-a",
        display_label: "演示 · 客户端配置",
        default_start_path: "/t/demo/",
        last_opened_at_client: "2026-04-23T09:30:00.000Z",
        is_default_profile: true,
        synced_at: "2026-04-23T09:31:05.123Z",
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
    playwright_shell_profiles: [],
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
