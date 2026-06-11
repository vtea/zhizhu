import { useCallback, useState, type KeyboardEvent } from "react";
import type { ClientStateDto } from "../../sharedTypes";
import { Banner, Button, Field, Pill, SectionCard, TextInput } from "../ui";
import { withTimeout } from "../utils";
import { useStatus } from "../hooks/useStatus";

type BindPanelProps = {
  state: ClientStateDto | null;
  refresh: () => Promise<void>;
};

export function BindPanel({ state, refresh }: BindPanelProps) {
  const { setStatus } = useStatus();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    if (busy || !window.zhizhu) return;
    if (code.trim().length === 0) {
      setStatus("请先填写绑定码。", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await withTimeout(
        window.zhizhu.bindDevice(code, label.trim().length > 0 ? label.trim() : undefined),
        60_000,
        "bind-device",
      );
      if (!r.ok) {
        setStatus(r.error, "error");
        return;
      }
      setStatus(`已绑定设备：${r.deviceId}（租户 ${r.tenantId}）`);
      setCode("");
      setLabel("");
      try {
        await refresh();
      } catch (re) {
        const m2 = re instanceof Error ? re.message : String(re);
        setStatus(`已绑定，但刷新状态失败：${m2}`, "error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`绑定失败：${msg}`, "error");
    } finally {
      setBusy(false);
    }
  }, [busy, code, label, refresh, setStatus]);

  const onCodeKey = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void submit();
    }
  };

  const deviceLine = state?.deviceId
    ? `本机设备 ID：${state.deviceId}`
    : "尚未绑定设备：在下方填写一次性绑定码后点击「绑定设备」。";

  const credLine =
    state?.hasDeviceAccessToken === true
      ? "Runner 设备凭证：已保存在本机。"
      : "Runner 设备凭证：未保存（未完成绑定或尚无 token）。";

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="设备绑定">
        <div className="flex flex-col gap-3">
          <p className="zz-meta-line">{deviceLine}</p>
          <p className="zz-meta-line" aria-live="polite">
            {credLine}
          </p>
          <Field
            label="设备绑定码"
            hint={(
              <span>
                一次性，<code className="font-mono">POST /api/v1/device-bind/consume</code>
              </span>
            )}
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={onCodeKey}
                aria-describedby={describedBy}
                placeholder="BIND-…（大小写均可，粘贴即可）"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
              />
            )}
          </Field>
          <Field label="本机显示名（可选）">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-describedby={describedBy}
                placeholder="例如：采集机-01"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void submit()} isLoading={busy}>
              绑定设备
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="本机 Runner 身份">
        <div className="flex flex-col gap-2">
          <p className="zz-meta-line">
            <Pill
              tone={
                state?.deviceId && state?.hasDeviceAccessToken === true
                  ? "success"
                  : state?.deviceId
                    ? "warn"
                    : "neutral"
              }
            >
              {state?.deviceId && state?.hasDeviceAccessToken === true
                ? "已绑定"
                : state?.deviceId
                  ? "缺凭证"
                  : "未绑定"}
            </Pill>
            <span className="ml-2">
              {state?.deviceId && state?.hasDeviceAccessToken === true
                ? `设备 ID 已登记：${state.deviceId}。`
                : state?.deviceId
                  ? `设备 ID 已登记但未检测到凭证；请重新完成绑定或检查 client-state.json。`
                  : "尚无设备 ID：完成上面绑定后此处会显示 Runner 身份摘要。"}
            </span>
          </p>
          <p className="zz-meta-line">
            <Pill tone={state?.hasDeviceAccessToken === true ? "success" : "neutral"}>
              {state?.hasDeviceAccessToken === true ? "凭证已落盘" : "未检测凭证"}
            </Pill>
            <span className="ml-2">
              {state?.hasDeviceAccessToken === true
                ? "凭证已落盘，供任务与 WSS 使用。"
                : "未检测到凭证；异常时请重新绑定或检查 client-state.json。"}
            </span>
          </p>
        </div>
      </SectionCard>

      <Banner kind="info">
        控制台员工账号、权限与个人资料请在浏览器中登录后查看；请使用上方按钮或首页入口打开 Web 控制台。
      </Banner>
    </div>
  );
}
