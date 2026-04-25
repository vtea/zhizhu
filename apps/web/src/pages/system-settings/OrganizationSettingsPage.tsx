import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import {
  createOrgMember,
  createOrgUnit,
  deleteOrgMember,
  listOrgTree,
  updateOrgMember,
  updateOrgUnit,
} from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { useTenantId } from "@/hooks/useTenantId";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";

type UnitRow = { id: string; parent_id: string | null; name: string; sort_order: number };
type MemberRow = { id: string; org_unit_id: string; display_name: string; email: string | null; platform_role: string };

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
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [unitName, setUnitName] = useState("");
  const [unitParent, setUnitParent] = useState("");
  const [memName, setMemName] = useState("");
  const [memEmail, setMemEmail] = useState("");
  const [memUnit, setMemUnit] = useState("");
  const [memRole, setMemRole] = useState("member");

  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const [editMemberId, setEditMemberId] = useState("");
  const [editMName, setEditMName] = useState("");
  const [editMEmail, setEditMEmail] = useState("");
  const [editMUnit, setEditMUnit] = useState("");
  const [editMRole, setEditMRole] = useState("");

  const editMemberIdRef = useRef(editMemberId);
  useEffect(() => {
    editMemberIdRef.current = editMemberId;
  }, [editMemberId]);

  const orgQ = useQuery({
    queryKey: ["org", tenantId],
    queryFn: () => listOrgTree(tenantId),
    enabled: api,
  });

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
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const memMut = useMutation({
    mutationFn: () =>
      createOrgMember(tenantId, {
        org_unit_id: memUnit.trim(),
        display_name: memName.trim(),
        email: memEmail.trim() || null,
        platform_role: memRole,
      }),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "成员已添加。" });
      setMemName("");
      setMemEmail("");
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

  const patchMemMut = useMutation({
    mutationFn: () =>
      updateOrgMember(tenantId, editMemberId.trim(), {
        display_name: editMName.trim(),
        email: editMEmail.trim() || null,
        org_unit_id: editMUnit.trim(),
        platform_role: editMRole.trim(),
      }),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "成员已更新。" });
      clearMemberEdit();
      await qc.invalidateQueries({ queryKey: ["org", tenantId] });
    },
    onError: (e) => setBanner({ kind: "err", text: formatApiErrorMessage(e, "失败") }),
  });

  const units = (orgQ.data?.units ?? []) as UnitRow[];
  const members = (orgQ.data?.members ?? []) as MemberRow[];
  const displayUnits = flatUnitTreeForDisplay(units);

  const unitNameOf = (id: string) => units.find((u) => u.id === id)?.name ?? id;

  function clearMemberEdit() {
    setEditMemberId("");
    setEditMName("");
    setEditMEmail("");
    setEditMUnit("");
    setEditMRole("");
  }

  function startEditMember(m: MemberRow) {
    setEditMemberId(m.id);
    setEditMName(m.display_name);
    setEditMEmail(m.email ?? "");
    setEditMUnit(m.org_unit_id);
    setEditMRole(m.platform_role);
    setBanner(null);
  }

  const memberColumns: DataColumn<MemberRow>[] = [
    { id: "n", header: "显示名", cell: (r) => r.display_name },
    { id: "mail", header: "邮箱", cell: (r) => r.email ?? "—" },
    { id: "role", header: "平台角色", cell: (r) => <span className="font-mono text-xs">{r.platform_role}</span> },
    { id: "ou", header: "部门", cell: (r) => unitNameOf(r.org_unit_id) },
    {
      id: "act",
      header: "操作",
      cell: (r) =>
        api ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-xs font-medium text-zz-blue hover:underline"
              onClick={() => startEditMember(r)}
            >
              编辑
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
              disabled={delMemMut.isPending && delMemMut.variables === r.id}
              onClick={() => {
                if (confirm(`移除成员「${r.display_name}」？`)) {
                  delMemMut.mutate(r.id);
                }
              }}
            >
              移除
            </button>
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
    memMut.mutate();
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
        description="先查看下方「部门结构」与「成员列表」了解现状；在「快速操作」中新建；在部门行上重命名、在成员行上编辑或移除。成员与控制台「员工账号」可并行维护，平台角色仅影响组织侧标识。"
      />
      {!api ? (
        <p className="rounded-lg border border-zz-border-light bg-zz-snow/40 px-4 py-3 text-sm text-zz-muted">
          请配置控制台接口并完成组织相关库迁移后，再查看与维护本页数据。
        </p>
      ) : orgQ.isError ? (
        <p className="text-sm text-red-700" role="alert">
          加载失败：{formatQueryError(orgQ.error, "加载失败")}
        </p>
      ) : (
        <>
          {banner ? (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                banner.kind === "err" ? "border-red-200 bg-red-50 text-red-800" : "border-zz-border-light bg-zz-snow text-zz-blue"
              }`}
              role={banner.kind === "err" ? "alert" : "status"}
            >
              {banner.text}
            </p>
          ) : null}

          <section
            className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-5 shadow-sm"
            aria-labelledby="org-overview-heading"
          >
            <h2 id="org-overview-heading" className="text-base font-semibold text-zz-near">
              1. 当前组织概览
            </h2>
            <p className="mt-1 text-sm text-zz-muted">
              按上下级缩进展示部门；成员以表格展示，可在此行内编辑、移除。
            </p>

            <div className="mt-6">
              <h3 className="text-sm font-medium text-zz-near">部门结构</h3>
              <ul className="mt-2 max-w-3xl divide-y divide-zz-border-light rounded-lg border border-zz-border-light bg-zz-snow/30 p-0 text-sm">
                {orgQ.isPending ? (
                  <li className="px-3 py-4 text-zz-muted">加载中…</li>
                ) : displayUnits.length === 0 ? (
                  <li className="px-3 py-4 text-zz-muted">暂无部门。请先在下方「快速操作」创建第一个部门，再添加成员。</li>
                ) : (
                  displayUnits.map(({ node: u, depth }) => (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                      <div
                        className="min-w-0 flex-1"
                        style={{ paddingLeft: `${12 + depth * 16}px` }}
                      >
                        {renamingUnitId === u.id ? (
                          <div className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                              className="w-full rounded-lg border border-zz-border px-3 py-1.5 text-sm"
                              value={renamingName}
                              onChange={(ev) => setRenamingName(ev.target.value)}
                              autoFocus
                              aria-label="部门新名称"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="rounded-full bg-zz-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
                                disabled={renameUnitMut.isPending}
                                onClick={onRenameSave}
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-zz-border bg-white px-3 py-1.5 text-xs"
                                onClick={() => {
                                  setRenamingUnitId(null);
                                  setRenamingName("");
                                }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-medium text-zz-near">{u.name}</span>
                            <span className="font-mono text-xs text-zz-muted" title="技术 ID，可在对接或排障时引用">
                              {u.id.slice(0, 8)}…
                            </span>
                          </div>
                        )}
                      </div>
                      {renamingUnitId !== u.id ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-medium text-zz-blue hover:underline"
                          onClick={() => {
                            setRenamingUnitId(u.id);
                            setRenamingName(u.name);
                            setBanner(null);
                          }}
                        >
                          重命名
                        </button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="mt-8">
              <h3 className="text-sm font-medium text-zz-near">成员列表</h3>
              <div className="mt-2">
                <DataTable
                  columns={memberColumns}
                  rows={members}
                  getRowKey={(r) => r.id}
                  emptyText={orgQ.isPending ? "加载中…" : "暂无成员。创建部门后，可在下方「添加成员」中录入。"}
                />
              </div>
            </div>
          </section>

          {editMemberId ? (
            <section
              className="rounded-[var(--radius-signature)] border border-zz-border-light bg-amber-50/60 p-5 shadow-sm"
              aria-labelledby="edit-member-heading"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="edit-member-heading" className="text-sm font-semibold text-zz-near">
                  正在编辑成员
                </h2>
                <button
                  type="button"
                  className="text-xs text-zz-muted hover:text-zz-near"
                  onClick={() => {
                    clearMemberEdit();
                    setBanner(null);
                  }}
                >
                  取消编辑
                </button>
              </div>
              <form
                className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  setBanner(null);
                  if (!editMemberId.trim() || !editMName.trim() || !editMUnit.trim()) {
                    setBanner({ kind: "err", text: "请填写显示名与部门" });
                    return;
                  }
                  patchMemMut.mutate();
                }}
              >
                <label className="block text-sm sm:col-span-2">
                  显示名
                  <input
                    className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={editMName}
                    onChange={(ev) => setEditMName(ev.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  邮箱
                  <input
                    type="email"
                    className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={editMEmail}
                    onChange={(ev) => setEditMEmail(ev.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  平台角色
                  <input
                    className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                    value={editMRole}
                    onChange={(ev) => setEditMRole(ev.target.value)}
                    placeholder="member / tenant_admin …"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  部门
                  <select
                    className="mt-1 w-full max-w-md rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={editMUnit}
                    onChange={(ev) => setEditMUnit(ev.target.value)}
                  >
                    <option value="">请选择</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={patchMemMut.isPending}
                    className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {patchMemMut.isPending ? "保存中…" : "保存成员"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section
            className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-5 shadow-sm"
            aria-labelledby="quick-actions-heading"
          >
            <h2 id="quick-actions-heading" className="text-base font-semibold text-zz-near">
              2. 快速操作
            </h2>
            <p className="mt-1 text-sm text-zz-muted">无部门时请先「新建部门」，再为部门「添加成员」。已有数据可在上方列表中重命名、编辑。</p>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-zz-near">新建部门</h3>
                <form className="mt-3 space-y-3" onSubmit={onUnitSubmit}>
                  <label className="block text-sm">
                    部门名称
                    <input
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={unitName}
                      onChange={(ev) => setUnitName(ev.target.value)}
                      placeholder="如：销售部、华东区"
                    />
                  </label>
                  <label className="block text-sm">
                    上级部门（可选）
                    <select
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={unitParent}
                      onChange={(ev) => setUnitParent(ev.target.value)}
                    >
                      <option value="">（不选 = 最顶层部门）</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={unitMut.isPending}
                    className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {unitMut.isPending ? "创建中…" : "创建部门"}
                  </button>
                </form>
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-medium text-zz-near">添加成员</h3>
                <form className="mt-3 space-y-3" onSubmit={onMemSubmit}>
                  <label className="block text-sm">
                    所属部门
                    <select
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={memUnit}
                      onChange={(ev) => setMemUnit(ev.target.value)}
                      required
                    >
                      <option value="">请选择部门</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    显示名
                    <input
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={memName}
                      onChange={(ev) => setMemName(ev.target.value)}
                      placeholder="在列表中展示的名称"
                    />
                  </label>
                  <label className="block text-sm">
                    邮箱（可选）
                    <input
                      type="email"
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={memEmail}
                      onChange={(ev) => setMemEmail(ev.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    平台角色
                    <input
                      className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                      value={memRole}
                      onChange={(ev) => setMemRole(ev.target.value)}
                      placeholder="一般为 member"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={memMut.isPending || units.length === 0}
                    className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                    title={units.length === 0 ? "请先创建部门" : undefined}
                  >
                    {memMut.isPending ? "提交中…" : "添加成员"}
                  </button>
                </form>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
