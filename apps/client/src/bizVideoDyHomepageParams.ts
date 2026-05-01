/**
 * 抖音最新视频同步：试跑时拉 runner/accounts 后合并主页 URL。
 */
import { mergeDyHomepageUrlIntoParams } from "./bizVideoDyHomepageMerge";
import { tenantDeviceHttpJson, type TenantDeviceApiContext } from "./employeePersonalAuthFileIngest";

export {
  DEFAULT_DOUYIN_LATEST_VIDEO_SYNC_GOTO_URL,
  mergeDyHomepageUrlIntoParams,
  MISSING_DY_HOMEPAGE_MESSAGE,
} from "./bizVideoDyHomepageMerge";

function hasNonEmptyDyHomepageUrl(p: Record<string, unknown>): boolean {
  const v = p.dy_homepage_url;
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 试跑等场景：拉 runner/accounts 后合并；无 ctx 时 accounts 为空（仅依赖 params.dy_homepage_url）。
 * 与队列任务 runnerLoop 一致：API 失败时不误报为「未维护 dy_user_url」。
 */
export async function enrichBizVideoParamsWithDyHomepage(
  ctx: TenantDeviceApiContext | null,
  params: Record<string, unknown>,
  accountIdForRun: string,
): Promise<Record<string, unknown>> {
  let accounts: Record<string, unknown>[] = [];
  let accountsFetchError: string | null = null;
  if (ctx) {
    const eid = typeof params.dy_leads_enterprise_id === "string" ? params.dy_leads_enterprise_id.trim() : "";
    /** 与 runnerLoop.fetchRunnerOpsAccounts 一致：须能解析到任务/试跑锚点账号的 dy_user_url，不因 paused 等状态从列表消失 */
    const suffix =
      eid.length > 0
        ? `/runner/accounts?dy_leads_enterprise_id=${encodeURIComponent(eid)}&active_ops_only=0`
        : "/runner/accounts?active_ops_only=0";
    const r = await tenantDeviceHttpJson<Record<string, unknown>[]>(ctx, "GET", suffix);
    if (r.ok) {
      if (Array.isArray(r.data)) {
        accounts = r.data;
      } else {
        accountsFetchError = "runner/accounts 响应正文不是账号数组";
      }
    } else {
      accountsFetchError = r.message;
    }
  }
  const merged = mergeDyHomepageUrlIntoParams(params, accountIdForRun, accounts, false);
  if (!merged.ok) {
    const needsAccountList = !hasNonEmptyDyHomepageUrl(params);
    if (accountsFetchError != null && needsAccountList) {
      throw new Error(`无法拉取 runner/accounts，无法按员工档案补全抖音主页链接：${accountsFetchError}`);
    }
    throw new Error(merged.message);
  }
  return merged.params;
}
