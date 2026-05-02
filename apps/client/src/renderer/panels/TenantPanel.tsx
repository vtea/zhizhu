import { useCallback, useEffect, useState } from "react";
import type { ClientStateDto } from "../../sharedTypes";
import { Banner, Button, Field, Pill, SectionCard, TextInput } from "../ui";
import { withTimeout } from "../utils";
import { useStatus } from "../hooks/useStatus";

type TenantPanelProps = {
  state: ClientStateDto | null;
  refresh: () => Promise<void>;
};

type RegistryLine = { kind: "info" | "ok" | "warn" | "error"; text: string };

export function TenantPanel({ state, refresh }: TenantPanelProps) {
  const { setStatus } = useStatus();
  const [tenant, setTenant] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [registry, setRegistry] = useState<RegistryLine>({ kind: "info", text: "API 登记状态：—" });

  useEffect(() => {
    if (!state) return;
    setTenant((prev) => (prev.length > 0 ? prev : state.effectiveTenantId));
  }, [state]);

  const fetchRegistry = useCallback(
    async (idOverride?: string): Promise<void> => {
      if (!window.zhizhu) return;
      const tid = (idOverride ?? tenant).trim().toLowerCase();
      if (!tid) {
        setRegistry({ kind: "warn", text: "API 登记状态：请先填写租户 ID。" });
        return;
      }
      setRegistry({ kind: "info", text: "API 登记状态：正在查询…" });
      try {
        const r = await withTimeout(window.zhizhu.fetchTenantRegistry(tid), 15_000, "fetch-tenant-registry");
        if (!r.ok) {
          setRegistry({ kind: "error", text: `API 登记状态：校验失败 — ${r.error}` });
          return;
        }
        setRegistry(
          r.exists
            ? { kind: "ok", text: "API 登记状态：服务器上已登记该租户。" }
            : { kind: "warn", text: "API 登记状态：服务器上未登记该租户。" },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRegistry({ kind: "error", text: `API 登记状态：请求失败 — ${msg}` });
      }
    },
    [tenant],
  );

  const onSave = useCallback(async (): Promise<void> => {
    if (saving || !window.zhizhu) return;
    setSaving(true);
    setStatus("正在校验租户信息（请求服务器）…", "info");
    try {
      const r = await withTimeout(window.zhizhu.setTenantId(tenant), 25_000, "set-tenant-id");
      if (!r.ok) {
        setStatus(r.error, "error");
        return;
      }
      const tid = tenant.trim().toLowerCase() || "（当前租户）";
      setStatus(`保存成功，欢迎使用！租户「${tid}」已写入本机；菜单与浏览器深链已更新。`, "info");
      try {
        await refresh();
        void fetchRegistry();
      } catch (re) {
        const m2 = re instanceof Error ? re.message : String(re);
        setStatus(`租户已保存，但刷新状态失败：${m2}`, "error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`保存失败：${msg}`, "error");
    } finally {
      setSaving(false);
    }
  }, [fetchRegistry, refresh, saving, setStatus, tenant]);

  const savedTenant =
    state?.savedTenantId != null && state.savedTenantId.length > 0
      ? state.savedTenantId
      : "（未单独保存过，可能为环境默认或最近一次设备绑定写入）";

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="租户深链配置">
        <div className="flex flex-col gap-3">
          <Field
            label="租户 ID"
            hint="小写英文/数字开头，可含 - 与 _，1–63 字符。"
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="demo（小写；可含 - 与 _）"
                aria-describedby={describedBy}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void onSave()} isLoading={saving}>
              保存
            </Button>
            <Button variant="ghost" onClick={() => void fetchRegistry()}>
              刷新登记状态
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="租户信息">
        <div className="flex flex-col gap-2">
          <p className="zz-meta-line">
            <span className="mr-2 text-zz-near">当前用于深链的租户：</span>
            <Pill tone="info">{state?.effectiveTenantId ?? "—"}</Pill>
          </p>
          <p className="zz-meta-line">
            <span className="mr-2 text-zz-near">本机已保存的租户：</span>
            <span>{savedTenant}</span>
          </p>
          <Banner kind={registry.kind === "ok" ? "ok" : registry.kind === "error" ? "error" : registry.kind === "warn" ? "warn" : "info"}>
            {registry.text}
          </Banner>
        </div>
      </SectionCard>

      <Banner kind="info">员工账号与个人资料在 Web 控制台维护；本窗口仅配置本机租户深链与登记校验。</Banner>
    </div>
  );
}
