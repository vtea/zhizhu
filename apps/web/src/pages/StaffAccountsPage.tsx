import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { createBizAccount, deleteBizAccount, listAccounts, updateBizAccount, type CreateBizAccountBody } from "@/api/accounts";
import { getApiBaseUrl } from "@/api/env";
import { useTenantId } from "@/hooks/useTenantId";
import { cardPanelTabClass } from "@/lib/segmentPillClass";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import type { MockAccount } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";

type TabId = "enterprise_staff" | "personal_authorized";

function parseTab(raw: string | null): TabId {
  return raw === "personal" ? "personal_authorized" : "enterprise_staff";
}

export function StaffAccountsPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [search, setSearch] = useSearchParams();
  const tab = parseTab(search.get("tab"));
  const [formErr, setFormErr] = useState<string | null>(null);
  const [newAccountId, setNewAccountId] = useState("");
  const [newKind, setNewKind] = useState<"enterprise_staff" | "personal_authorized">("enterprise_staff");
  const [newEnt, setNewEnt] = useState("ent-001");
  const [newNick, setNewNick] = useState("");
  const [newUnique, setNewUnique] = useState("");
  const [editAccount, setEditAccount] = useState<MockAccount | null>(null);
  const [eNick, setENick] = useState("");
  const [eUnique, setEUnique] = useState("");
  const [eEntId, setEEntId] = useState("");
  const [eEntName, setEEntName] = useState("");
  const [eRemark, setERemark] = useState("");
  const [createFormOpen, setCreateFormOpen] = useState(false);
  /** 表格级操作（如直接点删除）错误；formErr 仍用于新建/编辑表单内 */
  const [tableActionErr, setTableActionErr] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["accounts", tenantId, tab],
    queryFn: () => listAccounts({ tenantId, accountKind: tab }),
  });

  const createMut = useMutation({
    mutationFn: (body: CreateBizAccountBody) => createBizAccount(tenantId, body),
    onSuccess: async () => {
      setFormErr(null);
      setNewAccountId("");
      setNewNick("");
      setNewUnique("");
      setCreateFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
    },
    onError: (e) => {
      setFormErr(formatApiErrorMessage(e, "失败"));
    },
  });

  const patchOpsMut = useMutation({
    mutationFn: (p: { platform: string; accountId: string; ops_status: "running" | "paused" }) =>
      updateBizAccount(tenantId, p.platform, p.accountId, { ops_status: p.ops_status }),
    onSuccess: async () => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
    },
    onError: (e) => {
      setFormErr(formatApiErrorMessage(e, "更新失败"));
    },
  });

  const saveDetailMut = useMutation({
    mutationFn: () => {
      if (!editAccount) {
        throw new Error("未选择账号");
      }
      return updateBizAccount(tenantId, editAccount.platform, editAccount.account_id, {
        dy_display_name: eNick.trim() || null,
        dy_unique_id: eUnique.trim() || null,
        dy_leads_enterprise_id: eEntId.trim() || editAccount.dy_leads_enterprise_id,
        dy_leads_enterprise_name: eEntName.trim() || null,
        remark: eRemark.trim() || null,
      });
    },
    onSuccess: async () => {
      setFormErr(null);
      setEditAccount(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
    },
    onError: (e) => {
      setFormErr(formatApiErrorMessage(e, "保存失败"));
    },
  });

  const delAccMut = useMutation({
    mutationFn: (p: { platform: string; accountId: string }) => deleteBizAccount(tenantId, p.platform, p.accountId),
    onSuccess: async () => {
      setFormErr(null);
      setTableActionErr(null);
      setEditAccount(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
    },
    onError: (e) => {
      setTableActionErr(formatApiErrorMessage(e, "删除失败"));
    },
  });

  function setTab(next: TabId) {
    setFormErr(null);
    setTableActionErr(null);
    setEditAccount(null);
    setCreateFormOpen(false);
    const sp = new URLSearchParams(search);
    if (next === "enterprise_staff") {
      sp.delete("tab");
    } else {
      sp.set("tab", "personal");
    }
    setSearch(sp, { replace: true });
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormErr(null);
    if (!newAccountId.trim()) {
      setFormErr("请填写抖音侧固定账号 ID（纯数字）");
      return;
    }
    createMut.mutate({
      account_id: newAccountId.trim(),
      account_kind: newKind,
      dy_leads_enterprise_id: newEnt.trim() || "ent-001",
      dy_display_name: newNick.trim() || null,
      dy_unique_id: newUnique.trim() || null,
      platform: "douyin",
    });
  }

  const accountColumns: DataColumn<MockAccount>[] = [
    { id: "nick", header: "展示昵称", cell: (r) => r.dy_nickname ?? "—" },
    { id: "uniq", header: "抖音号", cell: (r) => <span className="font-mono text-xs">{r.dy_unique_id ?? "—"}</span> },
    {
      id: "account",
      header: "抖音固定账号 ID",
      cell: (r) => <span className="font-mono text-xs">{r.account_id}</span>,
    },
    { id: "ent", header: "企业主体", cell: (r) => r.dy_leads_enterprise_name ?? r.dy_leads_enterprise_id },
    {
      id: "status",
      header: "运营状态",
      cell: (r) =>
        api ? (
          <select
            className="rounded border border-zz-border px-2 py-1 text-xs"
            value={r.ops_status}
            disabled={
              patchOpsMut.isPending &&
              patchOpsMut.variables?.accountId === r.account_id &&
              patchOpsMut.variables?.platform === r.platform
            }
            onChange={(ev) => {
              const v = ev.target.value === "paused" ? "paused" : "running";
              if (v === r.ops_status) {
                return;
              }
              patchOpsMut.mutate({ platform: r.platform, accountId: r.account_id, ops_status: v });
            }}
          >
            <option value="running">运营中</option>
            <option value="paused">暂停</option>
          </select>
        ) : r.ops_status === "running" ? (
          "运营中"
        ) : (
          "暂停"
        ),
    },
    ...(api
      ? ([
          {
            id: "more",
            header: "操作",
            cell: (r: MockAccount) => (
              <div className="flex flex-nowrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue hover:text-zz-blue focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/30"
                  onClick={() => {
                    setFormErr(null);
                    setTableActionErr(null);
                    setEditAccount(r);
                    setENick(r.dy_nickname ?? "");
                    setEUnique(r.dy_unique_id ?? "");
                    setEEntId(r.dy_leads_enterprise_id ?? "");
                    setEEntName(r.dy_leads_enterprise_name ?? "");
                    setERemark(r.remark ?? "");
                  }}
                >
                  编辑资料
                </button>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-red-300/40 disabled:opacity-50"
                  disabled={
                    delAccMut.isPending &&
                    delAccMut.variables?.accountId === r.account_id &&
                    delAccMut.variables?.platform === r.platform
                  }
                  onClick={() => {
                    if (confirm(`确定删除该抖音固定账号？若有线索或视频仍引用该账号，删除将失败。`)) {
                      setTableActionErr(null);
                      delAccMut.mutate({ platform: r.platform, accountId: r.account_id });
                    }
                  }}
                >
                  删除
                </button>
              </div>
            ),
          },
        ] as DataColumn<MockAccount>[])
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="员工账号管理"
        description="维护本租户在抖音矩阵侧绑定的业务账号；连接控制台服务且具备租户管理员权限时，可在此新增账号并启停运营状态。"
      />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-zz-border-light pb-px">
        <div className="flex gap-2" role="tablist" aria-label="账号类型">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "enterprise_staff"}
            className={cardPanelTabClass(tab === "enterprise_staff")}
            onClick={() => setTab("enterprise_staff")}
          >
            企业员工号
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "personal_authorized"}
            className={cardPanelTabClass(tab === "personal_authorized")}
            onClick={() => setTab("personal_authorized")}
          >
            员工个人号授权
          </button>
        </div>
        {api ? (
          <button
            type="button"
            className="shrink-0 rounded-full border border-zz-border bg-white px-4 py-2 text-sm font-medium text-zz-near shadow-sm transition hover:border-zz-near hover:bg-zz-snow focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/30"
            onClick={() => {
              setFormErr(null);
              setTableActionErr(null);
              setNewKind(tab);
              setCreateFormOpen(true);
            }}
          >
            添加账号
          </button>
        ) : null}
      </div>

      {api && createFormOpen ? (
        <section className="mb-8 max-w-2xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
          <h2 className="text-sm font-semibold text-zz-near">新建账号</h2>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(ev) => onCreate(ev)}>
            <label className="block text-sm sm:col-span-2">
              抖音固定账号 ID（纯数字，与线索版后台一致）
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={newAccountId}
                onChange={(ev) => setNewAccountId(ev.target.value)}
                placeholder="例如 7123456789012345678"
              />
            </label>
            <label className="block text-sm">
              账号类型（与当前页签一致时可不改）
              <select
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={newKind}
                onChange={(ev) => setNewKind(ev.target.value as typeof newKind)}
              >
                <option value="enterprise_staff">企业员工号</option>
                <option value="personal_authorized">员工个人号授权</option>
              </select>
            </label>
            <label className="block text-sm">
              线索版企业主体标识
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={newEnt}
                onChange={(ev) => setNewEnt(ev.target.value)}
                placeholder="与矩阵后台主体一致，如 ent-001"
              />
            </label>
            <label className="block text-sm">
              展示昵称（可选）
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={newNick}
                onChange={(ev) => setNewNick(ev.target.value)}
              />
            </label>
            <label className="block text-sm">
              抖音号（可选，对外展示的短号）
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={newUnique}
                onChange={(ev) => setNewUnique(ev.target.value)}
              />
            </label>
            {formErr ? (
              <p className="text-sm text-red-700 sm:col-span-2">{formErr}</p>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={createMut.isPending}
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {createMut.isPending ? "创建中…" : "创建账号"}
              </button>
              <button
                type="button"
                className="rounded-full border border-zz-border px-4 py-2 text-sm"
                disabled={createMut.isPending}
                onClick={() => {
                  setFormErr(null);
                  setCreateFormOpen(false);
                }}
              >
                取消
              </button>
            </div>
          </form>
        </section>
      ) : !api ? (
        <p className="mb-6 rounded-lg border border-zz-border-light bg-zz-snow/40 px-4 py-3 text-sm text-zz-muted">
          未连接控制台接口时为本地演示列表；在环境变量中配置接口地址并登录后，可在此真实新增与维护账号。
        </p>
      ) : null}

      {api && editAccount ? (
        <section className="mb-8 max-w-2xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
          <h2 className="text-sm font-semibold text-zz-near">编辑账号</h2>
          <p className="mt-1 text-xs text-zz-muted">
            抖音固定账号 ID：<span className="font-mono text-zz-near">{editAccount.account_id}</span>
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              展示昵称
              <input className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={eNick} onChange={(ev) => setENick(ev.target.value)} />
            </label>
            <label className="block text-sm">
              抖音号
              <input className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={eUnique} onChange={(ev) => setEUnique(ev.target.value)} />
            </label>
            <label className="block text-sm">
              线索版企业主体标识
              <input className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm" value={eEntId} onChange={(ev) => setEEntId(ev.target.value)} />
            </label>
            <label className="block text-sm">
              企业主体名称
              <input className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={eEntName} onChange={(ev) => setEEntName(ev.target.value)} />
            </label>
            <label className="block text-sm sm:col-span-2">
              备注（可选）
              <input className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={eRemark} onChange={(ev) => setERemark(ev.target.value)} />
            </label>
          </div>
          {formErr ? <p className="mt-2 text-sm text-red-700">{formErr}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={saveDetailMut.isPending}
              onClick={() => saveDetailMut.mutate()}
            >
              {saveDetailMut.isPending ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="rounded-full border border-zz-border px-4 py-2 text-sm"
              onClick={() => {
                setFormErr(null);
                setEditAccount(null);
              }}
            >
              关闭
            </button>
          </div>
        </section>
      ) : null}

      {query.isError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(query.error)}
        </div>
      ) : null}
      {tableActionErr ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {tableActionErr}
        </div>
      ) : null}
      <DataTable
        columns={accountColumns}
        rows={query.data ?? []}
        getRowKey={(r) => r.id}
        emptyText={query.isPending ? "加载中…" : "暂无账号数据"}
      />
    </div>
  );
}
