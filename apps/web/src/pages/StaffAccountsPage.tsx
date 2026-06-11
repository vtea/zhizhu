import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import {
  createBizAccount,
  deleteBizAccountWithConfirm,
  fetchBizAccountAssociationCounts,
  listAccounts,
  listAllAccounts,
  repointDetachedPlaceholderAccount,
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
import {
  formatBizAccountAuthStatusUi,
  normalizeBizAccountOpsStatusUi,
  type MockAccount,
} from "@/mocks/seed";
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MockAccount | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmDetach, setDeleteConfirmDetach] = useState(false);
  const [deleteDialogErr, setDeleteDialogErr] = useState<string | null>(null);
  const [repointDialogOpen, setRepointDialogOpen] = useState(false);
  const [repointTarget, setRepointTarget] = useState<MockAccount | null>(null);
  const [repointToAccountId, setRepointToAccountId] = useState("");
  const [repointPassword, setRepointPassword] = useState("");
  const [repointDialogErr, setRepointDialogErr] = useState<string | null>(null);

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

  const assocCountsQuery = useQuery({
    queryKey: ["account-delete-assoc", tenantId, deleteTarget?.platform, deleteTarget?.account_id],
    queryFn: () => fetchBizAccountAssociationCounts(tenantId, deleteTarget!.platform, deleteTarget!.account_id),
    enabled: Boolean(api && deleteDialogOpen && deleteTarget),
  });

  const deleteConfirmMut = useMutation({
    mutationFn: (p: { platform: string; accountId: string; password: string; confirm_detach: boolean }) =>
      deleteBizAccountWithConfirm(tenantId, p.platform, p.accountId, {
        password: p.password,
        confirm_detach: p.confirm_detach,
      }),
    onSuccess: async () => {
      setFormErr(null);
      setTableActionErr(null);
      setEditAccount(null);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeletePassword("");
      setDeleteConfirmDetach(false);
      setDeleteDialogErr(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["account-delete-assoc", tenantId] });
    },
    onError: (e) => {
      setDeleteDialogErr(formatApiErrorMessage(e, "删除失败"));
    },
  });

  const repointMut = useMutation({
    mutationFn: (p: { platform: string; placeholderAccountId: string; password: string; to_account_id: string }) =>
      repointDetachedPlaceholderAccount(tenantId, p.platform, p.placeholderAccountId, {
        password: p.password,
        to_account_id: p.to_account_id,
      }),
    onSuccess: async () => {
      setTableActionErr(null);
      setRepointDialogOpen(false);
      setRepointTarget(null);
      setRepointToAccountId("");
      setRepointPassword("");
      setRepointDialogErr(null);
      await qc.invalidateQueries({ queryKey: ["accounts", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-all", tenantId] });
      await qc.invalidateQueries({ queryKey: ["accounts-ops-eligible", tenantId] });
      await qc.invalidateQueries({ queryKey: ["leads-enterprises-visible", tenantId] });
    },
    onError: (e) => {
      setRepointDialogErr(formatApiErrorMessage(e, "迁移失败"));
    },
  });

  const repointCandidates = useMemo(() => {
    if (!repointTarget || !allAccountsQuery.data) {
      return [];
    }
    return allAccountsQuery.data.filter(
      (a) =>
        a.platform === repointTarget.platform &&
        !a.account_id.startsWith("__detached__:") &&
        sameDyLeadsEnterpriseId(a.dy_leads_enterprise_id ?? "", repointTarget.dy_leads_enterprise_id ?? ""),
    );
  }, [repointTarget, allAccountsQuery.data]);

  const assocTotal = useMemo(() => {
    const c = assocCountsQuery.data;
    if (!c) {
      return 0;
    }
    return c.leads + c.videos + c.tasks + c.placements;
  }, [assocCountsQuery.data]);

  const needsDetachConfirm = assocTotal > 0;
  const deleteSubmitDisabled =
    deleteConfirmMut.isPending ||
    assocCountsQuery.isPending ||
    assocCountsQuery.isError ||
    !deletePassword.trim() ||
    (needsDetachConfirm && !deleteConfirmDetach);

  function setTab(next: TabId) {
    setFormErr(null);
    setTableActionErr(null);
    setEditAccount(null);
    setCreateFormOpen(false);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
    setDeletePassword("");
    setDeleteConfirmDetach(false);
    setDeleteDialogErr(null);
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
      id: "auth_status",
      header: "授权状态",
      cell: (r) => <span className="text-xs">{formatBizAccountAuthStatusUi(r.auth_status)}</span>,
    },
    {
      id: "status",
      header: "运营状态",
      cell: (r) => {
        const st = normalizeBizAccountOpsStatusUi(r.ops_status);
        const detachedPh = r.account_id.startsWith("__detached__:");
        return api ? (
          <SelectInput
            className="h-8 w-full py-1 text-xs sm:w-auto"
            value={st}
            disabled={
              detachedPh ||
              (patchOpsMut.isPending &&
                patchOpsMut.variables?.accountId === r.account_id &&
                patchOpsMut.variables?.platform === r.platform)
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
                {r.account_id.startsWith("__detached__:") ? (
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={
                      repointMut.isPending &&
                      repointMut.variables?.placeholderAccountId === r.account_id &&
                      repointMut.variables?.platform === r.platform
                    }
                    onClick={() => {
                      setFormErr(null);
                      setTableActionErr(null);
                      const cand = (allAccountsQuery.data ?? []).filter(
                        (a) =>
                          a.platform === r.platform &&
                          !a.account_id.startsWith("__detached__:") &&
                          sameDyLeadsEnterpriseId(a.dy_leads_enterprise_id ?? "", r.dy_leads_enterprise_id ?? ""),
                      );
                      setRepointTarget(r);
                      setRepointToAccountId(cand[0]?.account_id ?? "");
                      setRepointPassword("");
                      setRepointDialogErr(null);
                      setRepointDialogOpen(true);
                    }}
                  >
                    迁移占位数据
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={r.account_id.startsWith("__detached__:")}
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
                    deleteConfirmMut.isPending &&
                    deleteConfirmMut.variables?.accountId === r.account_id &&
                    deleteConfirmMut.variables?.platform === r.platform
                  }
                  onClick={() => {
                    setFormErr(null);
                    setTableActionErr(null);
                    setDeleteTarget(r);
                    setDeletePassword("");
                    setDeleteConfirmDetach(false);
                    setDeleteDialogErr(null);
                    setDeleteDialogOpen(true);
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
      <div className="flex flex-col gap-3 border-b border-zz-border-light pb-px sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
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

      {api ? (
        <OverlaySectionCard
          open={deleteDialogOpen}
          onClose={() => {
            if (deleteConfirmMut.isPending) {
              return;
            }
            setDeleteDialogOpen(false);
            setDeleteTarget(null);
            setDeletePassword("");
            setDeleteConfirmDetach(false);
            setDeleteDialogErr(null);
          }}
          title="删除账号"
          titleAs="h2"
          className="sm:max-w-lg"
          description={
            deleteTarget ? (
              <>
                抖音固定账号 ID{" "}
                <span className="font-mono text-zz-near">{deleteTarget.account_id}</span>
              </>
            ) : null
          }
        >
          {deleteTarget ? (
            <div className="grid gap-4">
              {assocCountsQuery.isPending ? (
                <p className="text-sm text-zz-muted">正在统计关联数据…</p>
              ) : assocCountsQuery.isError ? (
                <Banner kind="error">无法加载关联统计：{formatQueryError(assocCountsQuery.error)}</Banner>
              ) : assocCountsQuery.data ? (
                <div className="rounded-lg border border-zz-border-light bg-zz-surface-muted/40 px-4 py-3 text-sm">
                  <p className="font-medium text-zz-near">关联数据概览</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-zz-muted">
                    <li>线索：{assocCountsQuery.data.leads}</li>
                    <li>视频：{assocCountsQuery.data.videos}</li>
                    <li>任务：{assocCountsQuery.data.tasks}</li>
                    <li>投放：{assocCountsQuery.data.placements}</li>
                  </ul>
                </div>
              ) : null}

              {needsDetachConfirm ? (
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={deleteConfirmDetach}
                    onChange={(ev) => setDeleteConfirmDetach(ev.target.checked)}
                  />
                  <span>
                    解除关联并删除该账号（保留线索、视频、任务与投放等业务记录，引用迁至系统占位账号）
                  </span>
                </label>
              ) : null}

              <Field label="登录密码">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(ev) => setDeletePassword(ev.target.value)}
                  />
                )}
              </Field>

              {deleteDialogErr ? <Banner kind="error">{deleteDialogErr}</Banner> : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="danger"
                  size="md"
                  isLoading={deleteConfirmMut.isPending}
                  disabled={deleteSubmitDisabled}
                  onClick={() => {
                    setDeleteDialogErr(null);
                    if (!deleteTarget) {
                      return;
                    }
                    if (needsDetachConfirm && !deleteConfirmDetach) {
                      setDeleteDialogErr("请先勾选解除关联");
                      return;
                    }
                    if (!deletePassword.trim()) {
                      setDeleteDialogErr("请输入登录密码");
                      return;
                    }
                    deleteConfirmMut.mutate({
                      platform: deleteTarget.platform,
                      accountId: deleteTarget.account_id,
                      password: deletePassword,
                      confirm_detach: deleteConfirmDetach,
                    });
                  }}
                >
                  {deleteConfirmMut.isPending ? "删除中…" : "确认删除"}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={deleteConfirmMut.isPending}
                  onClick={() => {
                    setDeleteDialogOpen(false);
                    setDeleteTarget(null);
                    setDeletePassword("");
                    setDeleteConfirmDetach(false);
                    setDeleteDialogErr(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zz-muted">未选择账号</p>
          )}
        </OverlaySectionCard>
      ) : null}

      {api ? (
        <OverlaySectionCard
          open={repointDialogOpen}
          onClose={() => {
            if (repointMut.isPending) {
              return;
            }
            setRepointDialogOpen(false);
            setRepointTarget(null);
            setRepointToAccountId("");
            setRepointPassword("");
            setRepointDialogErr(null);
          }}
          title="迁移解绑占位数据"
          titleAs="h2"
          className="sm:max-w-lg"
          description={
            repointTarget ? (
              <>
                占位账号{" "}
                <span className="font-mono text-zz-near">{repointTarget.account_id}</span>
                上的线索/视频等待归属到真实抖音号后，Runner 才能再次按账号采集。
              </>
            ) : null
          }
        >
          {repointTarget ? (
            <div className="grid gap-4">
              <p className="text-sm text-zz-muted">
                删除员工账号时若勾选了保留业务数据，系统会把引用迁到「已解绑占位」行。请选定同一企业主体下的真实账号承接这些数据；迁移完成后占位行会自动删除。
              </p>
              {repointCandidates.length ? (
                <Field label="目标真实账号（抖音固定 ID）">
                  {({ id, describedBy }) => (
                    <SelectInput
                      id={id}
                      aria-describedby={describedBy}
                      className="w-full font-mono text-xs"
                      value={repointToAccountId}
                      onChange={(ev) => setRepointToAccountId(ev.target.value)}
                    >
                      <option value="">请选择</option>
                      {repointCandidates.map((a) => (
                        <option key={a.account_id} value={a.account_id}>
                          {a.dy_nickname ?? a.account_id} ({a.account_id})
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
              ) : (
                <Banner kind="error">
                  当前主体下没有可承接的真实账号。请先添加企业员工号或个人授权号，再执行迁移。
                </Banner>
              )}

              <Field label="登录密码">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    autoComplete="current-password"
                    value={repointPassword}
                    onChange={(ev) => setRepointPassword(ev.target.value)}
                  />
                )}
              </Field>

              {repointDialogErr ? <Banner kind="error">{repointDialogErr}</Banner> : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="primary"
                  size="md"
                  isLoading={repointMut.isPending}
                  disabled={
                    repointMut.isPending ||
                    !repointPassword.trim() ||
                    !repointToAccountId.trim() ||
                    repointCandidates.length === 0
                  }
                  onClick={() => {
                    setRepointDialogErr(null);
                    if (!repointTarget || !repointToAccountId.trim() || !repointPassword.trim()) {
                      setRepointDialogErr("请选择目标账号并输入登录密码");
                      return;
                    }
                    repointMut.mutate({
                      platform: repointTarget.platform,
                      placeholderAccountId: repointTarget.account_id,
                      password: repointPassword,
                      to_account_id: repointToAccountId.trim(),
                    });
                  }}
                >
                  {repointMut.isPending ? "迁移中…" : "确认迁移并删除占位"}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={repointMut.isPending}
                  onClick={() => {
                    setRepointDialogOpen(false);
                    setRepointTarget(null);
                    setRepointToAccountId("");
                    setRepointPassword("");
                    setRepointDialogErr(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zz-muted">未选择账号</p>
          )}
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
