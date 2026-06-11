import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SectionCard, SelectInput, TextInput } from "@/components/ui";
import {
  createOrgMember,
  createOrgUnit,
  deleteLeadsEnterprise,
  deleteOrgUnit,
  deleteOrgMember,
  listOrgTree,
  patchLeadsEnterprise,
  replaceOrgUnitLeadsEnterprises,
  replaceOrgMemberLeadsEnterprises,
  upsertLeadsEnterprise,
  updateOrgMember,
  updateOrgUnit,
  type OrgTreeResponse,
} from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { getSmtpConfigStatus, mailStatusAvailable } from "@/api/mail";
import { LOGIN_USERNAME_HINT, validateLoginUsernameClient } from "@/auth/loginUsernameRules";
import { useSession } from "@/hooks/useSession";
import { useTenantId } from "@/hooks/useTenantId";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";

type UnitRow = { id: string; parent_id: string | null; name: string; sort_order: number };
type MemberRow = {
  id: string;
  org_unit_id: string;
  display_name: string;
  email: string | null;
  platform_role: string;
  console_login_username?: string | null;
  has_console_login?: boolean;
};

/** API / 驱动可能返回非严格 boolean；有登录名也视为已开通 */
function memberHasConsoleLogin(m?: Pick<MemberRow, "has_console_login" | "console_login_username"> | null): boolean {
  if (!m) return false;
  const h = m.has_console_login as unknown;
  if (h === true || h === "true" || h === 1) return true;
  const u = m.console_login_username;
  return typeof u === "string" && u.trim().length > 0;
}
type LeadsEntRow = NonNullable<OrgTreeResponse["enterprises"]>[number];

/**
 * 将 `parent_id` 指向已删父级、自身或成环的节点视为「顶层」，并保证**每一行**都会在列表中渲染（不丢、不栈溢出）。
 */
function flatUnitTreeForDisplay(units: UnitRow[]): { node: UnitRow; depth: number }[] {
  const idSet = new Set(units.map((u) => u.id));
  const normalized: UnitRow[] = units.map((u) => {
    const p = u.parent_id;
    if (p && (p === u.id || !idSet.has(p))) {
      return { ...u, parent_id: null };
    }
    return u;
  });

  const byParent = new Map<string | null, UnitRow[]>();
  for (const u of normalized) {
    const p = u.parent_id;
    let list = byParent.get(p);
    if (!list) {
      list = [];
      byParent.set(p, list);
    }
    list.push(u);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hans"));
  }
  const out: { node: UnitRow; depth: number }[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number) {
    if (depth > 64) {
      return;
    }
    for (const n of byParent.get(parentId) ?? []) {
      if (visited.has(n.id)) {
        continue;
      }
      visited.add(n.id);
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);

  const rest = normalized.filter((u) => !visited.has(u.id));
  if (rest.length > 0) {
    rest.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hans"));
    for (const n of rest) {
      out.push({ node: n, depth: 0 });
    }
  }
  return out;
}

export function OrganizationSettingsPage() {
  const tenantId = useTenantId();
  const session = useSession();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [catalogEntId, setCatalogEntId] = useState("");
  const [catalogEntName, setCatalogEntName] = useState("");

  const [manageUnitEntsDialog, setManageUnitEntsDialog] = useState<{ unitId: string; picks: Record<string, boolean> } | null>(
    null,
  );

  const [editMemberEntPicks, setEditMemberEntPicks] = useState<Record<string, boolean>>({});

  const [unitName, setUnitName] = useState("");
  const [unitParent, setUnitParent] = useState("");
  const [memName, setMemName] = useState("");
  const [memEmail, setMemEmail] = useState("");
  const [memUnit, setMemUnit] = useState("");
  const [memRole, setMemRole] = useState("member");
  const [memLoginUsername, setMemLoginUsername] = useState("");
  const [memPassword, setMemPassword] = useState("");
  const [memSendWelcome, setMemSendWelcome] = useState(false);
  const [quickDialog, setQuickDialog] = useState<"unit" | "member" | "enterprise" | null>(null);

  const [editEnt, setEditEnt] = useState<{
    dy_leads_enterprise_id: string;
    display_name: string;
    status: "active" | "archived";
  } | null>(null);

  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const [editMemberId, setEditMemberId] = useState("");
  const [editMName, setEditMName] = useState("");
  const [editMEmail, setEditMEmail] = useState("");
  const [editMUnit, setEditMUnit] = useState("");
  const [editMRole, setEditMRole] = useState("");
  const [editMLoginUsername, setEditMLoginUsername] = useState("");
  const [editMPassword, setEditMPassword] = useState("");
  const [editMSendWelcome, setEditMSendWelcome] = useState(false);

  const editMemberIdRef = useRef(editMemberId);
  useEffect(() => {
    editMemberIdRef.current = editMemberId;
  }, [editMemberId]);

  const orgQ = useQuery({
    queryKey: ["org", tenantId],
    queryFn: () => listOrgTree(tenantId),
    enabled: api,
  });

  const smtpQ = useQuery({
    queryKey: ["smtp-status", "org-member", tenantId],
    queryFn: () => getSmtpConfigStatus(),
    enabled: api && mailStatusAvailable() && Boolean(session?.accessToken),
    staleTime: 30_000,
  });
  const smtpLikelyReady = smtpQ.data?.likely_ready === true;

  const unitMut = useMutation({
    mutationFn: () =>
      createOrgUnit(tenantId, {
        name: unitName.trim(),
        parent_id: unitParent.trim() ? unitParent.trim() : null,
        sort_order: 0,
      }),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "部门已创建。" });
      setUnitName("");
      setUnitParent("");
      setQuickDialog(null);
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const memMut = useMutation({
    mutationFn: () => {
      const loginU = memLoginUsername.trim().toLowerCase();
      const wantsConsole = loginU.length > 0 || memPassword.length > 0;
      const payload: Parameters<typeof createOrgMember>[1] = {
        org_unit_id: memUnit.trim(),
        display_name: memName.trim(),
        email: memEmail.trim() || null,
        platform_role: memRole,
      };
      if (wantsConsole) {
        payload.login_username = loginU;
        payload.password = memPassword;
        if (memSendWelcome) {
          payload.send_welcome_email = true;
        }
      }
      return createOrgMember(tenantId, payload);
    },
    onSuccess: async (data) => {
      const mailErr = data.mail_error != null && data.mail_error !== "";
      const extra = mailErr
        ? `邮件未发出：${data.mail_error}`
        : data.mail_sent === true
          ? "已尝试发送账户邮件。"
          : "";
      setBanner({
        kind: mailErr ? "err" : "ok",
        text: mailErr ? `成员已添加，但${extra}` : `成员已添加。${extra ? ` ${extra}` : ""}`.trim(),
      });
      setMemName("");
      setMemEmail("");
      setMemLoginUsername("");
      setMemPassword("");
      setMemSendWelcome(false);
      setQuickDialog(null);
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const delMemMut = useMutation({
    mutationFn: (id: string) => deleteOrgMember(tenantId, id),
    onSuccess: async (_void, deletedId) => {
      setBanner({ kind: "ok", text: "成员已移除。" });
      if (editMemberIdRef.current === deletedId) {
        clearMemberEdit();
      }
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const renameUnitMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateOrgUnit(tenantId, id, { name }),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "部门名称已更新。" });
      setRenamingUnitId(null);
      setRenamingName("");
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });
  const delUnitMut = useMutation({
    mutationFn: (id: string) => deleteOrgUnit(tenantId, id),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "部门已删除。" });
      if (renamingUnitId) {
        setRenamingUnitId(null);
        setRenamingName("");
      }
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const catalogEntMut = useMutation({
    mutationFn: () =>
      upsertLeadsEnterprise(tenantId, {
        dy_leads_enterprise_id: catalogEntId.trim(),
        display_name: catalogEntName.trim() || null,
        status: "active",
      }),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "企业主体已登记。" });
      setCatalogEntId("");
      setCatalogEntName("");
      setQuickDialog(null);
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
      await qc.invalidateQueries({ queryKey: ["org-ent-catalog", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "登记失败") }),
  });

  const patchEntMut = useMutation({
    mutationFn: async () => {
      if (!editEnt) throw new Error("NO_ENT");
      await patchLeadsEnterprise(tenantId, editEnt.dy_leads_enterprise_id, {
        display_name: editEnt.display_name.trim() || null,
        status: editEnt.status,
      });
    },
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "企业主体已更新。" });
      setEditEnt(null);
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
      await qc.invalidateQueries({ queryKey: ["org-ent-catalog", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "更新失败") }),
  });

  const delEntMut = useMutation({
    mutationFn: (dyLeadsEnterpriseId: string) => deleteLeadsEnterprise(tenantId, dyLeadsEnterpriseId),
    onSuccess: async (_void, deletedDy) => {
      setBanner({ kind: "ok", text: "企业主体已删除。" });
      setEditEnt((cur) => (sameDyLeadsEnterpriseId(cur?.dy_leads_enterprise_id, deletedDy) ? null : cur));
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
      await qc.invalidateQueries({ queryKey: ["org-ent-catalog", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "删除失败") }),
  });

  const saveUnitEntsMut = useMutation({
    mutationFn: async ({
      unitId,
      picks,
    }: {
      unitId: string;
      picks: Record<string, boolean>;
    }) => {
      const ids = Object.entries(picks)
        .filter(([, checked]) => checked)
        .map(([dy]) => dy);
      await replaceOrgUnitLeadsEnterprises(tenantId, unitId, ids);
    },
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "部门与企业主体关联已保存。" });
      setManageUnitEntsDialog(null);
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "保存失败") }),
  });

  const patchMemMut = useMutation({
    mutationFn: async () => {
      if (!editMemberId.trim() || !editMName.trim() || !editMUnit.trim()) {
        throw new Error("INVALID");
      }
      const mid = editMemberId.trim();
      const tree = qc.getQueryData<OrgTreeResponse>(["org", tenantId]);
      const ms = (tree?.members ?? []) as MemberRow[];
      const row = ms.find((m) => m.id === mid);
      const hasConsole = memberHasConsoleLogin(row);

      const patch: Parameters<typeof updateOrgMember>[2] = {
        display_name: editMName.trim(),
        email: editMEmail.trim() || null,
        org_unit_id: editMUnit.trim(),
        platform_role: editMRole.trim(),
      };
      const pw = editMPassword.trim();
      if (pw.length > 0) {
        patch.password = pw;
      }
      if (!hasConsole && editMLoginUsername.trim()) {
        patch.login_username = editMLoginUsername.trim().toLowerCase();
      }
      if (editMSendWelcome) {
        patch.send_welcome_email = true;
      }

      const out = await updateOrgMember(tenantId, mid, patch);
      const chosen = Object.entries(editMemberEntPicks)
        .filter(([, checked]) => checked)
        .map(([dy]) => dy);
      await replaceOrgMemberLeadsEnterprises(tenantId, mid, chosen);
      return out;
    },
    onSuccess: async (data) => {
      const mailErr = data.mail_error != null && data.mail_error !== "";
      const extra = mailErr
        ? `邮件未发出：${data.mail_error}`
        : data.mail_sent === true
          ? "已尝试发送账户邮件。"
          : "";
      setBanner({
        kind: mailErr ? "err" : "ok",
        text: mailErr ? `成员已保存，但${extra}` : `成员已更新。${extra ? ` ${extra}` : ""}`.trim(),
      });
      clearMemberEdit();
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "INVALID") {
        setBanner({ kind: "err", text: "请填写显示名与部门" });
        return;
      }
      setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") });
    },
  });

  const units = (orgQ.data?.units ?? []) as UnitRow[];
  const members = (orgQ.data?.members ?? []) as MemberRow[];
  const orgTree = orgQ.data as OrgTreeResponse | undefined;
  const enterpriseRows = orgTree?.enterprises ?? [];
  const orgUnitEnterprises = orgTree?.org_unit_enterprises ?? [];
  const orgMemberEnterprises = orgTree?.org_member_enterprises ?? [];
  const displayUnits = flatUnitTreeForDisplay(units);
  const editingMember = members.find((m) => m.id === editMemberId);

  const unitNameOf = (id: string) => units.find((u) => u.id === id)?.name ?? id;

  function entLabel(dy: string): string {
    const r = enterpriseRows.find((x) => sameDyLeadsEnterpriseId(x.dy_leads_enterprise_id, dy));
    const d = (r?.display_name as string | undefined)?.trim();
    return d || dy;
  }

  function deptEnterpriseIds(unitId: string): string[] {
    const s = new Set<string>();
    for (const r of orgUnitEnterprises) {
      if (r.org_unit_id === unitId && r.dy_leads_enterprise_id) {
        s.add(r.dy_leads_enterprise_id);
      }
    }
    return [...s];
  }

  function toggleRecord(r: Record<string, boolean>, key: string): Record<string, boolean> {
    const next = { ...r, [key]: !r[key] };
    return next;
  }

  function clearMemberEdit() {
    setEditMemberId("");
    setEditMName("");
    setEditMEmail("");
    setEditMUnit("");
    setEditMRole("");
    setEditMLoginUsername("");
    setEditMPassword("");
    setEditMSendWelcome(false);
    setEditMemberEntPicks({});
  }

  function startEditMember(m: MemberRow) {
    setEditMemberId(m.id);
    setEditMName(m.display_name);
    setEditMEmail(m.email ?? "");
    setEditMUnit(m.org_unit_id);
    setEditMRole(m.platform_role);
    setEditMLoginUsername("");
    setEditMPassword("");
    setEditMSendWelcome(false);
    setBanner(null);
    const narrowed = orgMemberEnterprises.filter((x) => x.org_member_id === m.id).map((x) => x.dy_leads_enterprise_id);
    const dept = deptEnterpriseIds(m.org_unit_id);
    const picks: Record<string, boolean> = {};
    if (narrowed.length > 0) {
      for (const id of dept) picks[id] = narrowed.includes(id);
    } else {
      for (const id of dept) picks[id] = true;
    }
    setEditMemberEntPicks(picks);
  }

  function startEditEnterprise(e: LeadsEntRow) {
    setBanner(null);
    setEditEnt({
      dy_leads_enterprise_id: e.dy_leads_enterprise_id,
      display_name: (e.display_name ?? "").trim(),
      status: e.status === "archived" ? "archived" : "active",
    });
  }

  const memberColumns: DataColumn<MemberRow>[] = [
    { id: "n", header: "显示名", cell: (r) => r.display_name },
    { id: "mail", header: "邮箱", cell: (r) => r.email ?? "—" },
    { id: "role", header: "平台角色", cell: (r) => <span className="font-mono text-xs">{r.platform_role}</span> },
    {
      id: "console",
      header: "控制台登录",
      cell: (r) =>
        memberHasConsoleLogin(r) ? (
          <span className="font-mono text-xs text-zz-near" title={r.console_login_username ?? ""}>
            {r.console_login_username ?? "—"}
          </span>
        ) : (
          <span className="text-sm text-zz-muted">未开通</span>
        ),
    },
    { id: "ou", header: "部门", cell: (r) => unitNameOf(r.org_unit_id) },
    {
      id: "act",
      header: "操作",
      cell: (r) =>
        api ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => startEditMember(r)}>
              编辑
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={delMemMut.isPending && delMemMut.variables === r.id}
              onClick={() => {
                if (confirm(`移除成员「${r.display_name}」？`)) {
                  delMemMut.mutate(r.id);
                }
              }}
            >
              移除
            </Button>
          </div>
        ) : null,
    },
  ];
  const unitColumns: DataColumn<{ node: UnitRow; depth: number }>[] = [
    {
      id: "unit-name",
      header: "部门结构",
      cell: ({ node: u }) =>
        renamingUnitId === u.id ? (
          <div className="max-w-xl">
            <TextInput value={renamingName} onChange={(ev) => setRenamingName(ev.target.value)} autoFocus aria-label="部门新名称" />
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium text-zz-near">{u.name}</span>
            <span className="font-mono text-xs text-zz-muted" title="技术 ID，可在对接或排障时引用">
              {u.id.slice(0, 8)}…
            </span>
          </div>
        ),
    },
    {
      id: "unit-act",
      header: "操作",
      /** 三项操作同一行展示，避免窄宽折行看起来像「标签叠在按钮上」 */
      className: "min-w-[17.5rem] max-w-[20rem]",
      cell: ({ node: u }) =>
        renamingUnitId !== u.id ? (
          <div className="flex flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={enterpriseRows.filter((e) => (e.status ?? "active") === "active").length === 0}
              title={
                enterpriseRows.filter((e) => (e.status ?? "active") === "active").length === 0
                  ? "请先在下方登记可用的企业主体后再关联部门"
                  : "勾选该部门适用的线索版企业主体"
              }
              onClick={() => {
                setBanner(null);
                const picks: Record<string, boolean> = {};
                const allIds = enterpriseRows.filter((e) => (e.status ?? "active") === "active").map((e) => e.dy_leads_enterprise_id);
                for (const dy of allIds) {
                  picks[dy] = orgUnitEnterprises.some(
                    (r) => r.org_unit_id === u.id && sameDyLeadsEnterpriseId(r.dy_leads_enterprise_id, dy),
                  );
                }
                setManageUnitEntsDialog({ unitId: u.id, picks });
              }}
            >
              关联主体
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRenamingUnitId(u.id);
                setRenamingName(u.name);
                setBanner(null);
              }}
            >
              编辑
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={delUnitMut.isPending && delUnitMut.variables === u.id}
              onClick={() => {
                if (confirm(`删除部门「${u.name}」？若该部门仍有成员，将被拒绝删除；子部门会提升为顶层。`)) {
                  setBanner(null);
                  delUnitMut.mutate(u.id);
                }
              }}
            >
              删除
            </Button>
          </div>
        ) : (
          <div className="flex flex-nowrap items-center justify-end gap-2">
            <Button variant="primary" size="sm" isLoading={renameUnitMut.isPending} onClick={onRenameSave}>
              保存
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRenamingUnitId(null);
                setRenamingName("");
              }}
            >
              取消
            </Button>
          </div>
        ),
    },
  ];

  const enterpriseColumns: DataColumn<LeadsEntRow>[] = [
    {
      id: "id",
      header: "主体 ID",
      cell: (r) => <span className="font-mono text-xs">{r.dy_leads_enterprise_id}</span>,
    },
    {
      id: "dn",
      header: "展示名",
      cell: (r) => <span>{r.display_name?.trim() ? r.display_name : "—"}</span>,
    },
    {
      id: "st",
      header: "状态",
      cell: (r) => <span className="font-mono text-xs">{r.status ?? "active"}</span>,
    },
    {
      id: "ent-act",
      header: "操作",
      className: "w-[160px]",
      cell: (r) =>
        api ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => startEditEnterprise(r)}>
              编辑
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={delEntMut.isPending && delEntMut.variables === r.dy_leads_enterprise_id}
              onClick={() => {
                const msg = [
                  `确定删除企业主体「${entLabel(r.dy_leads_enterprise_id)}」？`,
                  "注意：「组织」里部门/成员已解绑，不等于可以删主体；若「员工账号」里仍有业务账号把该主体作为归属，仍会拦截。",
                ].join("\n");
                if (confirm(msg)) {
                  setBanner(null);
                  delEntMut.mutate(r.dy_leads_enterprise_id);
                }
              }}
            >
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  function onUnitSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!unitName.trim()) {
      setBanner({ kind: "err", text: "请填写部门名称" });
      return;
    }
    unitMut.mutate();
  }

  function onMemSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!memUnit.trim() || !memName.trim()) {
      setBanner({ kind: "err", text: "请选择部门并填写成员显示名" });
      return;
    }
    const loginU = memLoginUsername.trim().toLowerCase();
    const wantsConsole = loginU.length > 0 || memPassword.length > 0;
    if (wantsConsole) {
      if (!memEmail.trim()) {
        setBanner({ kind: "err", text: "创建登录账号时须填写有效邮箱" });
        return;
      }
      if (!memEmail.includes("@")) {
        setBanner({ kind: "err", text: "请填写有效邮箱" });
        return;
      }
      const uErr = validateLoginUsernameClient(loginU);
      if (uErr) {
        setBanner({ kind: "err", text: uErr });
        return;
      }
      if (memPassword.length < 8) {
        setBanner({ kind: "err", text: "密码至少 8 位" });
        return;
      }
      if (memSendWelcome && !smtpLikelyReady) {
        setBanner({ kind: "err", text: "发信环境未就绪（SMTP 主机/端口/发件人未齐），无法勾选发送邮件" });
        return;
      }
    } else if (memSendWelcome) {
      setBanner({ kind: "err", text: "发送账户邮件须同时填写登录用户名、密码与邮箱" });
      return;
    }
    memMut.mutate();
  }

  function onEnterpriseSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!catalogEntId.trim()) {
      setBanner({ kind: "err", text: "请填写主体标识" });
      return;
    }
    catalogEntMut.mutate();
  }

  function onEditEntSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!editEnt) return;
    patchEntMut.mutate();
  }

  function onRenameSave() {
    setBanner(null);
    if (!renamingUnitId || !renamingName.trim()) {
      setBanner({ kind: "err", text: "请填写新名称" });
      return;
    }
    renameUnitMut.mutate({ id: renamingUnitId, name: renamingName.trim() });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        titleAs="h2"
        title="组织与成员"
      />
      {!api ? (
        <Banner kind="info">请配置控制台接口并完成组织相关库迁移后，再查看与维护本页数据。</Banner>
      ) : orgQ.isError ? (
        <Banner kind="error">加载失败：{formatQueryError(orgQ.error, "加载失败")}</Banner>
      ) : (
        <>
          {banner ? <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner> : null}

          <SectionCard
            title="当前组织概览"
            titleAs="h2"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-zz-near">部门结构</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setBanner(null);
                      setUnitName("");
                      setUnitParent("");
                      setQuickDialog("unit");
                    }}
                  >
                    添加部门
                  </Button>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <DataTable
                    columns={unitColumns}
                    rows={displayUnits}
                    getRowKey={(r) => r.node.id}
                    emptyText={orgQ.isPending ? "加载中…" : "暂无部门。"}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-zz-near">成员列表</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={units.length === 0}
                    title={units.length === 0 ? "请先创建部门" : undefined}
                    onClick={() => {
                      setBanner(null);
                      setMemName("");
                      setMemEmail("");
                      setMemLoginUsername("");
                      setMemPassword("");
                      setMemSendWelcome(false);
                      setMemUnit(units[0]?.id ?? "");
                      setMemRole("member");
                      setQuickDialog("member");
                    }}
                  >
                    添加成员
                  </Button>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <DataTable
                    columns={memberColumns}
                    rows={members}
                    getRowKey={(r) => r.id}
                    emptyText={orgQ.isPending ? "加载中…" : "暂无成员。"}
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          {editMemberId ? (
            <OverlaySectionCard
              open
              onClose={() => {
                clearMemberEdit();
                setBanner(null);
              }}
              title="正在编辑成员"
              titleAs="h2"
              className="max-w-3xl bg-amber-50/60"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clearMemberEdit();
                    setBanner(null);
                  }}
                >
                  取消编辑
                </Button>
              }
            >
              <form
                className="grid max-w-3xl gap-4 sm:grid-cols-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  setBanner(null);
                  if (!editMemberId.trim() || !editMName.trim() || !editMUnit.trim()) {
                    setBanner({ kind: "err", text: "请填写显示名与部门" });
                    return;
                  }
                  const hasC = memberHasConsoleLogin(editingMember);
                  const pw = editMPassword.trim();
                  const loginU = editMLoginUsername.trim().toLowerCase();
                  if (editMSendWelcome) {
                    if (!pw || pw.length < 8) {
                      setBanner({ kind: "err", text: "发送账户邮件须同时设置至少 8 位新密码" });
                      return;
                    }
                    if (!smtpLikelyReady) {
                      setBanner({ kind: "err", text: "发信环境未就绪（SMTP 主机/端口/发件人未齐），无法勾选发送邮件" });
                      return;
                    }
                    if (!editMEmail.trim() || !editMEmail.includes("@")) {
                      setBanner({ kind: "err", text: "发送邮件须填写有效成员邮箱" });
                      return;
                    }
                  }
                  if (pw.length > 0 && pw.length < 8) {
                    setBanner({ kind: "err", text: "密码至少 8 位" });
                    return;
                  }
                  if (!hasC && (loginU.length > 0 || pw.length > 0)) {
                    if (!editMEmail.trim() || !editMEmail.includes("@")) {
                      setBanner({ kind: "err", text: "开通控制台登录须填写有效邮箱" });
                      return;
                    }
                    const uErr = validateLoginUsernameClient(loginU);
                    if (uErr) {
                      setBanner({ kind: "err", text: uErr });
                      return;
                    }
                    if (!loginU || pw.length < 8) {
                      setBanner({ kind: "err", text: "开通控制台登录须填写登录用户名与至少 8 位密码" });
                      return;
                    }
                  }
                  patchMemMut.mutate();
                }}
              >
                <Field className="sm:col-span-2" label="显示名">
                  {({ id }) => <TextInput id={id} value={editMName} onChange={(ev) => setEditMName(ev.target.value)} />}
                </Field>
                <Field label="邮箱">
                  {({ id }) => (
                    <TextInput id={id} type="email" value={editMEmail} onChange={(ev) => setEditMEmail(ev.target.value)} />
                  )}
                </Field>
                <Field label="平台角色">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      mono
                      value={editMRole}
                      onChange={(ev) => setEditMRole(ev.target.value)}
                      placeholder="member / tenant_admin …"
                    />
                  )}
                </Field>
                <Field className="sm:col-span-2" label="控制台登录">
                  {({ id }) =>
                    memberHasConsoleLogin(editingMember) ? (
                      <div id={id} className="text-sm text-zz-near">
                        已开通，登录名{" "}
                        <span className="font-mono text-xs">{editingMember?.console_login_username ?? "—"}</span>
                      </div>
                    ) : (
                      <div id={id} className="text-sm text-zz-muted">
                        尚未开通 Web 控制台登录；可在下方填写登录名与密码以开通。
                      </div>
                    )}
                </Field>
                {!memberHasConsoleLogin(editingMember) ? (
                  <Field label="登录用户名（开通用）" hint={LOGIN_USERNAME_HINT}>
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={editMLoginUsername}
                        onChange={(ev) => setEditMLoginUsername(ev.target.value)}
                        placeholder="与新建成员时规则一致"
                        autoComplete="off"
                      />
                    )}
                  </Field>
                ) : null}
                <Field
                  className={!memberHasConsoleLogin(editingMember) ? "" : "sm:col-span-2"}
                  label={memberHasConsoleLogin(editingMember) ? "新密码（留空不改）" : "初始密码（开通用）"}
                  hint="至少 8 位；保存时写入控制台账号。"
                >
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="password"
                      value={editMPassword}
                      onChange={(ev) => setEditMPassword(ev.target.value)}
                      autoComplete="new-password"
                    />
                  )}
                </Field>
                <div className="sm:col-span-2 flex flex-col gap-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zz-border-light"
                      checked={editMSendWelcome}
                      disabled={!smtpLikelyReady}
                      onChange={() => setEditMSendWelcome((v) => !v)}
                    />
                    <span>将账户信息（登录地址、租户名、登录名与本次密码）发送到成员邮箱</span>
                  </label>
                  {!smtpLikelyReady ? (
                    <p className="text-xs text-zz-muted">
                      发信未就绪：请在 API 环境配置 SMTP 与 CONSOLE_WEB_PUBLIC_URL；详见「系统设置 → 邮件（SMTP）」。
                    </p>
                  ) : null}
                </div>
                <Field className="sm:col-span-2" label="部门">
                  {({ id }) => (
                    <SelectInput
                      id={id}
                      value={editMUnit}
                      onChange={(ev) => {
                        const nv = ev.target.value;
                        setEditMUnit(nv);
                        const d = deptEnterpriseIds(nv);
                        setEditMemberEntPicks(Object.fromEntries(d.map((dy) => [dy, true])));
                      }}
                    >
                      <option value="">请选择</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
                {deptEnterpriseIds(editMUnit).length ? (
                  <div className="sm:col-span-2 space-y-2 rounded-[14px] border border-zz-border-light p-3">
                    <div className="text-xs text-zz-muted">
                      勾选该成员可查看的线索版主体（须已分配给当前部门）。全选=与部门一致；仅选子集时视为「窄化」。
                    </div>
                    <div className="flex flex-col gap-2">
                      {deptEnterpriseIds(editMUnit).map((dy) => (
                        <label key={dy} className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zz-border-light"
                            checked={editMemberEntPicks[dy] ?? false}
                            onChange={() => setEditMemberEntPicks((r) => toggleRecord(r, dy))}
                          />
                          <span>
                            {entLabel(dy)} <span className="font-mono text-xs text-zz-muted">({dy})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="sm:col-span-2 rounded-[14px] border border-dashed border-amber-200 bg-amber-50/40 p-3 text-sm text-zz-muted">
                    当前部门尚未关联任何企业主体；请先在上方「部门结构」表格中对应部门行点「企业主体」勾选。
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Button type="submit" variant="primary" size="md" isLoading={patchMemMut.isPending}>
                    {patchMemMut.isPending ? "保存中…" : "保存成员"}
                  </Button>
                </div>
              </form>
            </OverlaySectionCard>
          ) : null}

          <SectionCard
            title="线索版企业主体（登记）"
            titleAs="h2"
            description="在此登记本公司在抖音线索里需要区分的业务主体（可按品牌或团队区分）。登记后，创建员工账号时从这里选择；谁能看哪些主体的数据，由上方部门与成员的设置决定。"
          >
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-zz-near">已登记主体</h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBanner(null);
                    setCatalogEntId("");
                    setCatalogEntName("");
                    setQuickDialog("enterprise");
                  }}
                >
                  登记企业主体
                </Button>
              </div>
              <div className="mt-2 overflow-x-auto">
                <DataTable
                  columns={enterpriseColumns}
                  rows={enterpriseRows as LeadsEntRow[]}
                  getRowKey={(r) => r.dy_leads_enterprise_id}
                  emptyText={orgQ.isPending ? "加载中…" : "暂无登记；请点击右上角登记。"}
                />
              </div>
            </div>
          </SectionCard>
        </>
      )}
      {manageUnitEntsDialog ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-[22px] border border-zz-border-light bg-zz-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-zz-near">部门适用的企业主体</h3>
              <Button variant="ghost" size="sm" onClick={() => setManageUnitEntsDialog(null)}>
                关闭
              </Button>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-auto">
              {enterpriseRows
                .filter((e) => (e.status ?? "active") === "active")
                .map((e) => (
                  <label key={e.dy_leads_enterprise_id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1 py-1 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={manageUnitEntsDialog.picks[e.dy_leads_enterprise_id] ?? false}
                      onChange={() =>
                        setManageUnitEntsDialog((cur) =>
                          cur
                            ? {
                                ...cur,
                                picks: toggleRecord(cur.picks, e.dy_leads_enterprise_id),
                              }
                            : cur,
                        )
                      }
                    />
                    <span className="text-sm">
                      {entLabel(e.dy_leads_enterprise_id)}{" "}
                      <span className="font-mono text-xs text-zz-muted">({e.dy_leads_enterprise_id})</span>
                    </span>
                  </label>
                ))}
              {enterpriseRows.filter((e) => (e.status ?? "active") === "active").length === 0 ? (
                <Banner kind="info">请先在下方「线索版企业主体（登记）」中登记至少一个企业主体。</Banner>
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="md"
                isLoading={saveUnitEntsMut.isPending}
                onClick={() => saveUnitEntsMut.mutate({ unitId: manageUnitEntsDialog.unitId, picks: manageUnitEntsDialog.picks })}
              >
                保存
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => setManageUnitEntsDialog(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {editEnt ? (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-xl rounded-[22px] border border-zz-border-light bg-zz-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-zz-near">编辑企业主体</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditEnt(null);
                  setBanner(null);
                }}
              >
                关闭
              </Button>
            </div>
            <form className="space-y-4" onSubmit={onEditEntSubmit}>
              <Field label="主体标识">
                {({ id }) => (
                  <TextInput id={id} mono readOnly value={editEnt.dy_leads_enterprise_id} className="bg-zz-snow/80" />
                )}
              </Field>
              <Field label="展示名称">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={editEnt.display_name}
                    onChange={(ev) => setEditEnt((cur) => (cur ? { ...cur, display_name: ev.target.value } : cur))}
                    placeholder="列表与选框中显示的名称"
                  />
                )}
              </Field>
              <Field label="状态">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={editEnt.status}
                    onChange={(ev) =>
                      setEditEnt((cur) =>
                        cur
                          ? {
                              ...cur,
                              status: ev.target.value === "archived" ? "archived" : "active",
                            }
                          : cur,
                      )
                    }
                  >
                    <option value="active">启用</option>
                    <option value="archived">已归档</option>
                  </SelectInput>
                )}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="md" isLoading={patchEntMut.isPending}>
                  {patchEntMut.isPending ? "保存中…" : "保存"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setEditEnt(null);
                    setBanner(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {quickDialog ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-xl rounded-[22px] border border-zz-border-light bg-zz-white p-6 shadow-xl">
            {quickDialog === "unit" ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-zz-near">添加部门</h3>
                  <Button variant="ghost" size="sm" onClick={() => setQuickDialog(null)}>
                    关闭
                  </Button>
                </div>
                <form className="space-y-4" onSubmit={onUnitSubmit}>
                  <Field label="部门名称">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        value={unitName}
                        onChange={(ev) => setUnitName(ev.target.value)}
                        placeholder="如：销售部、华东区"
                      />
                    )}
                  </Field>
                  <Field label="上级部门（可选）">
                    {({ id }) => (
                      <SelectInput id={id} value={unitParent} onChange={(ev) => setUnitParent(ev.target.value)}>
                        <option value="">（不选 = 最顶层部门）</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="md" isLoading={unitMut.isPending}>
                      {unitMut.isPending ? "创建中…" : "创建部门"}
                    </Button>
                    <Button type="button" variant="secondary" size="md" onClick={() => setQuickDialog(null)}>
                      取消
                    </Button>
                  </div>
                </form>
              </>
            ) : quickDialog === "member" ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-zz-near">添加成员</h3>
                  <Button variant="ghost" size="sm" onClick={() => setQuickDialog(null)}>
                    关闭
                  </Button>
                </div>
                <form className="space-y-4" onSubmit={onMemSubmit}>
                  <Field label="所属部门">
                    {({ id }) => (
                      <SelectInput id={id} value={memUnit} onChange={(ev) => setMemUnit(ev.target.value)} required>
                        <option value="">请选择部门</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                  </Field>
                  <Field label="显示名">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        value={memName}
                        onChange={(ev) => setMemName(ev.target.value)}
                        placeholder="在列表中展示的名称"
                      />
                    )}
                  </Field>
                  <Field label="邮箱（可选）">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        type="email"
                        value={memEmail}
                        onChange={(ev) => setMemEmail(ev.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="登录用户名（可选）"
                    hint={`填写后将为该成员创建控制台登录，须同时设置密码与邮箱。${LOGIN_USERNAME_HINT}`}
                  >
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={memLoginUsername}
                        onChange={(ev) => setMemLoginUsername(ev.target.value)}
                        placeholder="与注册页规则一致，登录可与邮箱二选一"
                        autoComplete="off"
                      />
                    )}
                  </Field>
                  <Field label="初始密码（可选）" hint="至少 8 位；与登录用户名、邮箱同时填写时创建可登录账号。">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        type="password"
                        value={memPassword}
                        onChange={(ev) => setMemPassword(ev.target.value)}
                        autoComplete="new-password"
                      />
                    )}
                  </Field>
                  <div className="flex flex-col gap-1">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zz-border-light"
                        checked={memSendWelcome}
                        disabled={!smtpLikelyReady}
                        onChange={() => setMemSendWelcome((v) => !v)}
                      />
                      <span>将账户信息发送到成员邮箱（须已填写登录名、密码与邮箱）</span>
                    </label>
                    {!smtpLikelyReady ? (
                      <p className="text-xs text-zz-muted">
                        发信未就绪：请在 API 环境配置 SMTP 与 CONSOLE_WEB_PUBLIC_URL。
                      </p>
                    ) : null}
                  </div>
                  <Field label="平台角色">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={memRole}
                        onChange={(ev) => setMemRole(ev.target.value)}
                        placeholder="一般为 member"
                      />
                    )}
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      isLoading={memMut.isPending}
                      disabled={units.length === 0}
                      title={units.length === 0 ? "请先创建部门" : undefined}
                    >
                      {memMut.isPending ? "提交中…" : "添加成员"}
                    </Button>
                    <Button type="button" variant="secondary" size="md" onClick={() => setQuickDialog(null)}>
                      取消
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-zz-near">登记企业主体</h3>
                  <Button variant="ghost" size="sm" onClick={() => setQuickDialog(null)}>
                    关闭
                  </Button>
                </div>
                <form className="space-y-4" onSubmit={onEnterpriseSubmit}>
                  <Field label="主体标识（创建后不可改）">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={catalogEntId}
                        onChange={(ev) => setCatalogEntId(ev.target.value)}
                        placeholder="如公司内约定的一串唯一标识"
                      />
                    )}
                  </Field>
                  <Field label="展示名称">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        value={catalogEntName}
                        onChange={(ev) => setCatalogEntName(ev.target.value)}
                        placeholder="公司内部称呼"
                      />
                    )}
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      isLoading={catalogEntMut.isPending}
                      disabled={!catalogEntId.trim()}
                    >
                      {catalogEntMut.isPending ? "保存中…" : "保存登记"}
                    </Button>
                    <Button type="button" variant="secondary" size="md" onClick={() => setQuickDialog(null)}>
                      取消
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
