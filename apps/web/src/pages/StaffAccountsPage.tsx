import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import {
  createBizAccount,
  deleteBizAccount,
  listAccounts,
  listAllAccounts,
  updateBizAccount,
  type CreateBizAccountBody,
} from "@/api/accounts";
import { listLeadsEnterprisesVisible } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useTenantId } from "@/hooks/useTenantId";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { cardPanelTabClass } from "@/lib/segmentPillClass";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { normalizeBizAccountOpsStatusUi, type MockAccount } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

type TabId = "enterprise_staff" | "personal_authorized";

function parseTab(raw: string | null): TabId {
  return raw === "personal" ? "personal_authorized" : "enterprise_staff";
}

export function StaffAccountsPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [search, setSearch] = useSearchParams();
  const tab = parseTab(search.get("tab"));
  const [formErr, setFormErr] = useState<string | null>(null);
  const [newAccountId, setNewAccountId] = useState("");
  const [newKind, setNewKind] = useState<"enterprise_staff" | "personal_authorized">("enterprise_staff");
  const [newEnt, setNewEnt] = useState("");
  const [newNick, setNewNick] = useState("");
  const [newUnique, setNewUnique] = useState("");
  const [newUserUrl, setNewUserUrl] = useState("");
  const [editAccount, setEditAccount] = useState<MockAccount | null>(null);
  const [eNick, setENick] = useState("");
  const [eUnique, setEUnique] = useState("");
  const [eUserUrl, setEUserUrl] = useState("");
  const [eEntId, setEEntId] = useState("");
  const [eEntName, setEEntName] = useState("");
  const [eRemark, setERemark] = useState("");
  const [createFormOpen, setCreateFormOpen] = useState(false);
  /** 表格级操作（如直接点删除）错误；formErr 仍用于新建/编辑表单内 */
  const [tableActionErr, setTableActionErr] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["accounts", tenantId, tab, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAccounts({ tenantId, accountKind: tab, dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId }),
  });
  const allAccountsQuery = useQuery({
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
  });
  const enterpriseCount = allAccountsQuery.data?.filter((a) => a.account_kind === "enterprise_staff").length;
  const personalCount = allAccountsQuery.data?.filter((a) => a.account_kind === "personal_authorized").length;

  const visibleEntQ = useQuery({
    queryKey: ["leads-enterprises-visible", tenantId],
    queryFn: () => listLeadsEnterprisesVisible(tenantId),
    enabled: api,
  });
  const registeredEnterprises =
    visibleEntQ.data?.enterprises?.filter((e) => (e.status ?? "active") === "active") ?? [];

  /** 下拉用：激活主体 +（编辑时）当前账号正在使用的主体（含已归档），避免受控下拉无匹配选项导致 PATCH 报错 */
  const enterprisePickerRows = useMemo(() => {
    const raw = visibleEntQ.data?.enterprises ?? [];
    const curId = editAccount?.dy_leads_enterprise_id?.trim() ?? "";
    const seen = new Set<string>();
    const out: typeof raw = [];
    for (const e of raw) {
      const id = e.dy_leads_enterprise_id?.trim();
      if (!id || seen.has(id)) continue;
      const active = (e.status ?? "active") === "active";
      if (active || sameDyLeadsEnterpriseId(id, curId)) {
        out.push(e);
        seen.add(id);
      }
    }
    if (curId && !out.some((x) => sameDyLeadsEnterpriseId(x.dy_leads_enterprise_id, curId))) {
      out.push({
        dy_leads_enterprise_id: curId,
        display_name: editAccount?.dy_leads_enterprise_name?.trim() || null,
        status: "archived",
      });
    }
    return out;
  }, [
    visibleEntQ.data?.enterprises,
    editAccount?.dy_leads_enterprise_id,
    editAccount?.dy_leads_enterprise_name,
  ]);

  const createMut = useMutation({
    mutationFn: (body: CreateBizAccountBody) => createBizAccount(tenantId, body),
    onSuccess: async () => {
      setFormErr(null);
      setNewAccountId("");
      setNewNick("");
      setNewUnique("");
      setNewUserUrl("");
      setCreateFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
    },
    onError: (e) => {
      setFormErr(formatApiErrorMessage(e, "失败"));
    },
  });

  const patchOpsMut = useMutation({
    mutationFn: (p: { platform: string; accountId: string; ops_status: "running" | "paused" | "revoked" }) =>
      updateBizAccount(tenantId, p.platform, p.accountId, { ops_status: p.ops_status }),
    onSuccess: async () => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
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
      const entResolved = eEntId.trim() || editAccount.dy_leads_enterprise_id?.trim() || "";
      if (editAccount.account_kind === "enterprise_staff" && !entResolved) {
        throw new Error("NO_ENTERPRISE");
      }
      /** 避免把空字符串送给 PATCH，服务端会校验「不能为空」→ 400 */
      const patch: Parameters<typeof updateBizAccount>[3] = {
        dy_display_name: eNick.trim() || null,
        dy_unique_id: eUnique.trim() || null,
        dy_user_url: eUserUrl.trim() || null,
        dy_leads_enterprise_name: eEntName.trim() || null,
        remark: eRemark.trim() || null,
      };
      if (entResolved && entResolved.trim().length > 0) {
        patch.dy_leads_enterprise_id = entResolved.trim();
      }
      return updateBizAccount(tenantId, editAccount.platform, editAccount.account_id, patch);
    },
    onSuccess: async () => {
      setFormErr(null);
      setEditAccount(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "NO_ENTERPRISE") {
        setFormErr("请选择线索版企业主体");
        return;
      }
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
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
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
    if (!newEnt.trim()) {
      setFormErr("请选择已在「组织与成员」登记的线索版企业主体");
      return;
    }
    createMut.mutate({
      account_id: newAccountId.trim(),
      account_kind: newKind,
      dy_leads_enterprise_id: newEnt.trim(),
      dy_display_name: newNick.trim() || null,
      dy_unique_id: newUnique.trim() || null,
      dy_user_url: newUserUrl.trim() || null,
      platform: "douyin",
    });
  }

  const accountColumns: DataColumn<MockAccount>[] = [
    {
      id: "nick",
      header: "账户名字",
      cell: (r) =>
        r.dy_user_url ? (
          <a
            className="text-zz-accent underline-offset-2 hover:underline"
            href={r.dy_user_url}
            target="_blank"
            rel="noreferrer"
          >
            {r.dy_nickname ?? "—"}
          </a>
        ) : (
          r.dy_nickname ?? "—"
        ),
    },
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
      cell: (r) => {
        const st = normalizeBizAccountOpsStatusUi(r.ops_status);
        return api ? (
          <SelectInput
            className="h-8 w-full py-1 text-xs sm:w-auto"
            value={st}
            disabled={
              patchOpsMut.isPending &&
              patchOpsMut.variables?.accountId === r.account_id &&
              patchOpsMut.variables?.platform === r.platform
            }
            onChange={(ev) => {
              const raw = ev.target.value;
              const v = raw === "paused" ? "paused" : raw === "revoked" ? "revoked" : "running";
              if (v === st) {
                return;
              }
              patchOpsMut.mutate({ platform: r.platform, accountId: r.account_id, ops_status: v });
            }}
          >
            <option value="running">运营中</option>
            <option value="paused">暂停</option>
            <option value="revoked">已撤销</option>
          </SelectInput>
        ) : st === "running" ? (
          "运营中"
        ) : st === "revoked" ? (
          "已撤销"
        ) : (
          "暂停"
        );
      },
    },
    ...(api
      ? ([
          {
            id: "more",
            header: "操作",
            cell: (r: MockAccount) => (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFormErr(null);
                    setTableActionErr(null);
                    setEditAccount(r);
                    setENick(r.dy_nickname ?? "");
                    setEUnique(r.dy_unique_id ?? "");
                    setEUserUrl(r.dy_user_url ?? "");
                    setEEntId(r.dy_leads_enterprise_id ?? "");
                    setEEntName(r.dy_leads_enterprise_name ?? "");
                    setERemark(r.remark ?? "");
                  }}
                >
                  编辑资料
                </Button>
                <Button
                  variant="danger"
                  size="sm"
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
                </Button>
              </div>
            ),
          },
        ] as DataColumn<MockAccount>[])
      : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="员工账号管理"
      />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zz-border-light pb-px">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="账号类型">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "enterprise_staff"}
            className={cardPanelTabClass(tab === "enterprise_staff")}
            onClick={() => setTab("enterprise_staff")}
          >
            企业员工号 {enterpriseCount ?? "…"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "personal_authorized"}
            className={cardPanelTabClass(tab === "personal_authorized")}
            onClick={() => setTab("personal_authorized")}
          >
            员工个人号授权 {personalCount ?? "…"}
          </button>
        </div>
        {api ? (
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setFormErr(null);
              setTableActionErr(null);
              setNewKind(tab);
              setCreateFormOpen(true);
            }}
          >
            添加账号
          </Button>
        ) : null}
      </div>

      {api ? (
        <OverlaySectionCard
          open={createFormOpen}
          onClose={() => {
            setFormErr(null);
            setCreateFormOpen(false);
          }}
          title="新建账号"
          titleAs="h2"
          className="sm:max-w-2xl"
        >
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => onCreate(ev)}>
            <Field
              className="sm:col-span-2"
              label="抖音固定账号 ID（纯数字，与线索版后台一致）"
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  mono
                  value={newAccountId}
                  onChange={(ev) => setNewAccountId(ev.target.value)}
                  placeholder="例如 7123456789012345678"
                />
              )}
            </Field>
            <Field label="账号类型（与当前页签一致时可不改）">
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  aria-describedby={describedBy}
                  value={newKind}
                  onChange={(ev) => setNewKind(ev.target.value as typeof newKind)}
                >
                  <option value="enterprise_staff">企业员工号</option>
                  <option value="personal_authorized">员工个人号授权</option>
                </SelectInput>
              )}
            </Field>
            <Field label="线索版企业主体">
              {({ id, describedBy }) =>
                registeredEnterprises.length ? (
                  <SelectInput id={id} aria-describedby={describedBy} value={newEnt} onChange={(ev) => setNewEnt(ev.target.value)}>
                    <option value="">请选择已登记主体</option>
                    {registeredEnterprises.map((e) => (
                      <option key={e.dy_leads_enterprise_id} value={e.dy_leads_enterprise_id}>
                        {(e.display_name ?? "").trim() || e.dy_leads_enterprise_id} ({e.dy_leads_enterprise_id})
                      </option>
                    ))}
                  </SelectInput>
                ) : (
                  <div className="text-sm text-zz-muted">请先在「系统设置 → 组织与成员」登记企业主体</div>
                )
              }
            </Field>
            <Field label="账户名字（可选）">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} value={newNick} onChange={(ev) => setNewNick(ev.target.value)} />
              )}
            </Field>
            <Field label="抖音号（可选，对外展示的短号）">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} value={newUnique} onChange={(ev) => setNewUnique(ev.target.value)} />
              )}
            </Field>
            <Field className="sm:col-span-2" label="主页（可选）">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={newUserUrl}
                  onChange={(ev) => setNewUserUrl(ev.target.value)}
                  placeholder="https://www.douyin.com/user/..."
                />
              )}
            </Field>
            {formErr ? (
              <div className="sm:col-span-2">
                <Banner kind="error">{formErr}</Banner>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" size="md" isLoading={createMut.isPending}>
                {createMut.isPending ? "创建中…" : "创建账号"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={createMut.isPending}
                onClick={() => {
                  setFormErr(null);
                  setCreateFormOpen(false);
                }}
              >
                取消
              </Button>
            </div>
          </form>
        </OverlaySectionCard>
      ) : !api ? (
        <Banner kind="info">未连接控制台接口时为本地演示列表；在环境变量中配置接口地址并登录后，可在此真实新增与维护账号。</Banner>
      ) : null}

      {api && editAccount ? (
        <OverlaySectionCard
          open
          onClose={() => {
            setFormErr(null);
            setEditAccount(null);
          }}
          title="编辑账号"
          titleAs="h2"
          ariaLabel="编辑员工账号资料"
          ariaLabelledBy="staff-account-edit-heading"
          className="sm:max-w-2xl"
          description={
            <>
              <span id="staff-account-edit-heading">抖音固定账号 ID</span>
              <span className="font-mono text-zz-near"> {editAccount.account_id}</span>
            </>
          }
        >
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <Field className="!gap-2" label="账户名字">
                {({ id }) => <TextInput id={id} value={eNick} onChange={(ev) => setENick(ev.target.value)} />}
              </Field>
              <Field className="!gap-2" label="抖音号">
                {({ id }) => <TextInput id={id} value={eUnique} onChange={(ev) => setEUnique(ev.target.value)} />}
              </Field>
              <Field className="!gap-2 sm:col-span-2" label="主页">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={eUserUrl}
                    onChange={(ev) => setEUserUrl(ev.target.value)}
                    placeholder="https://www.douyin.com/user/..."
                  />
                )}
              </Field>
              <Field className="!gap-2 min-w-0" label="线索版企业主体">
                {({ id }) =>
                  enterprisePickerRows.length ? (
                    <SelectInput
                      id={id}
                      className="w-full max-w-full"
                      value={eEntId}
                      onChange={(ev) => {
                        const vid = ev.target.value;
                        setEEntId(vid);
                        const hit = enterprisePickerRows.find((x) => sameDyLeadsEnterpriseId(x.dy_leads_enterprise_id, vid));
                        if (hit?.display_name) {
                          setEEntName(hit.display_name ?? "");
                        }
                      }}
                    >
                      {enterprisePickerRows.map((e) => (
                        <option key={e.dy_leads_enterprise_id} value={e.dy_leads_enterprise_id}>
                          {(e.display_name ?? "").trim() || e.dy_leads_enterprise_id}
                          {(e.status ?? "active") !== "active" ? "（已归档）" : ""} ({e.dy_leads_enterprise_id})
                        </option>
                      ))}
                    </SelectInput>
                  ) : (
                    <span className="text-sm text-zz-muted">无可用主体；请在「组织与成员」登记</span>
                  )
                }
              </Field>
              <Field className="!gap-2 min-w-0" label="企业主体名称">
                {({ id }) => <TextInput id={id} value={eEntName} onChange={(ev) => setEEntName(ev.target.value)} />}
              </Field>
              <Field className="!gap-2 sm:col-span-2" label="备注（可选）">
                {({ id }) => <TextInput id={id} value={eRemark} onChange={(ev) => setERemark(ev.target.value)} />}
              </Field>
            </div>
            {formErr ? (
              <div className="mt-5">
                <Banner kind="error">{formErr}</Banner>
              </div>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-zz-border-light pt-6 sm:justify-end">
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setFormErr(null);
                  setEditAccount(null);
                }}
              >
                关闭
              </Button>
              <Button variant="primary" size="md" isLoading={saveDetailMut.isPending} onClick={() => saveDetailMut.mutate()}>
                {saveDetailMut.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
        </OverlaySectionCard>
      ) : null}

      {query.isError ? <Banner kind="error">加载失败：{formatQueryError(query.error)}</Banner> : null}
      {tableActionErr ? <Banner kind="error">{tableActionErr}</Banner> : null}
      <DataTable
        columns={accountColumns}
        rows={query.data ?? []}
        getRowKey={(r) => r.id}
        emptyText={query.isPending ? "加载中…" : "暂无账号数据"}
      />
    </div>
  );
}
