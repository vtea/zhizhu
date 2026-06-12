/**
 * 抖音最新视频同步：执行阶段按员工账号运营状态（ops_status）过滤采集名单（纯函数）。
 *
 * 任务 payload 中的 `account_ids` 在创建时已冻结；账号随后被「暂停 / 撤销」时队列任务仍会携带它们。
 * Runner 在循环前用 `/runner/accounts?active_ops_only=0` 拉到的档案行（含规范化 `ops_status`）做一次过滤，
 * `paused` / `revoked` 的账号不进入采集循环。
 */
import { normalizeBizVideoParamAccountId } from "./bizVideoIngestParams";

export type BizVideoOpsSkippedAccount = {
  account_id: string;
  ops_status: "paused" | "revoked";
  /** 档案里的昵称（dy_nickname），仅用于日志/摘要展示 */
  dy_nickname: string | null;
};

export type BizVideoOpsStatusSplit = {
  eligible: string[];
  skipped: BizVideoOpsSkippedAccount[];
};

function strTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 将 runList 按档案 `ops_status` 切分为可采集（eligible）与跳过（skipped）。
 *
 * - 账号未在 `opsAccounts` 中匹配到 → 视为可采集（保持现有 merge 阻断逻辑兜底，不在此处误杀）。
 * - `ops_status` 为 `paused` / `revoked` → 跳过；其余（`running`、空、异常值）→ 可采集。
 * - 调用方在 `/runner/accounts` 拉取失败时不应调用本函数（保持原行为，不因查询失败阻断任务）。
 */
export function splitBizVideoRunListByOpsStatus(
  runList: string[],
  opsAccounts: Record<string, unknown>[],
): BizVideoOpsStatusSplit {
  const statusByAccountId = new Map<string, { ops_status: string; dy_nickname: string | null }>();
  for (const row of opsAccounts) {
    const id = normalizeBizVideoParamAccountId(row.account_id).toLowerCase();
    if (!id) {
      continue;
    }
    statusByAccountId.set(id, {
      ops_status: strTrim(row.ops_status).toLowerCase(),
      dy_nickname: strTrim(row.dy_nickname) || null,
    });
  }
  const eligible: string[] = [];
  const skipped: BizVideoOpsSkippedAccount[] = [];
  for (const accountId of runList) {
    const found = statusByAccountId.get(accountId.trim().toLowerCase());
    if (found && (found.ops_status === "paused" || found.ops_status === "revoked")) {
      skipped.push({
        account_id: accountId,
        ops_status: found.ops_status,
        dy_nickname: found.dy_nickname,
      });
      continue;
    }
    eligible.push(accountId);
  }
  return { eligible, skipped };
}

export function formatBizVideoOpsStatusZh(s: "paused" | "revoked"): string {
  return s === "paused" ? "已暂停" : "已撤销";
}

/** 拼一条人可读的跳过日志/摘要行，如「账户名字「张三」（账号 123，已暂停）」 */
export function formatBizVideoOpsSkippedAccountZh(a: BizVideoOpsSkippedAccount): string {
  const label = a.dy_nickname ? `「${a.dy_nickname}」（账号 ${a.account_id}）` : `账号 ${a.account_id}`;
  return `${label}：${formatBizVideoOpsStatusZh(a.ops_status)}`;
}
