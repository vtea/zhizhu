import { useCallback, useState } from "react";
import type { PlaywrightBrowserProfileRecord } from "../../sharedTypes";
import { Banner, Button, Field, Modal, Pill, SectionCard, TextInput } from "../ui";
import { useStatus } from "../hooks/useStatus";
import { usePlaywrightHeaded } from "../hooks/usePlaywrightHeaded";
import { usePlaywrightProfiles } from "../hooks/usePlaywrightProfiles";
import { formatTs, withTimeout } from "../utils";

type PlaywrightPanelProps = {
  active: boolean;
};

type EditDraft = {
  id: string;
  label: string;
  slug: string;
  defaultStartPath: string;
  createdAt?: string;
  updatedAt?: string;
};

type PanelModal = { kind: "closed" } | { kind: "create" } | { kind: "edit"; draft: EditDraft };

function describeClientConfigSyncStatus(s: {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorStatus: number | null;
  lastErrorMessage: string | null;
  lastSentProfileCount: number | null;
}): string {
  const parts: string[] = [];
  if (s.lastOkAt) {
    parts.push(`上次成功 ${formatTs(s.lastOkAt)}`);
    if (typeof s.lastSentProfileCount === "number") {
      parts.push(`已上行 ${s.lastSentProfileCount} 条`);
    }
  } else {
    parts.push("尚未成功同步");
  }
  if (s.lastErrorAt && (!s.lastOkAt || s.lastErrorAt > s.lastOkAt)) {
    const code = s.lastErrorStatus == null ? "" : ` HTTP ${s.lastErrorStatus}`;
    const msg = s.lastErrorMessage ? ` — ${s.lastErrorMessage}` : "";
    parts.push(`最近失败 ${formatTs(s.lastErrorAt)}${code}${msg}`);
  }
  return `客户端配置同步：${parts.join("；")}。`;
}

function describeVisualSessions(state: ReturnType<typeof usePlaywrightHeaded>): string {
  if (state.status === null || state.codegenRunning === null) {
    return state.errorMsg ? `读取状态失败：${state.errorMsg}` : "Playwright 会话状态：加载中…";
  }

  const cg = state.codegenRunning === true;
  const s = state.status;

  let base: string;
  if (cg && s.running) {
    const { profileSlug, pid } = s;
    const pidPart = pid != null ? ` · pid ${pid}` : "";
    base = `Codegen 录制中 · 「打开可视化浏览器」也在运行 · slug ${profileSlug}${pidPart}`;
  } else if (cg && !s.running) {
    base = "Codegen 录制中（Inspector + Chromium）；「打开可视化浏览器」未单独启动。";
  } else if (!cg && s.running) {
    const { profileSlug, pid } = s;
    const pidPart = pid != null ? ` · pid ${pid}` : "";
    base = `「可视化浏览器」运行中 · slug ${profileSlug}${pidPart} · Codegen 未运行`;
  } else {
    base = "「打开可视化浏览器」与 Codegen 均未运行。";
  }

  return state.errorMsg ? `${base}（轮询提示：${state.errorMsg}）` : base;
}

export function PlaywrightPanel({ active }: PlaywrightPanelProps) {
  const { setStatus } = useStatus();
  const headed = usePlaywrightHeaded(active);
  const profiles = usePlaywrightProfiles(active);

  const [creatingSlug, setCreatingSlug] = useState("");
  const [creatingLabel, setCreatingLabel] = useState("");
  const [creatingPath, setCreatingPath] = useState("");
  const [modal, setModal] = useState<PanelModal>({ kind: "closed" });
  const [forceSyncBusy, setForceSyncBusy] = useState(false);

  const closeModal = useCallback((): void => {
    setModal({ kind: "closed" });
  }, []);

  const openCreateModal = useCallback((): void => {
    setCreatingSlug("");
    setCreatingLabel("");
    setCreatingPath("");
    setModal({ kind: "create" });
  }, []);

  const patchEditDraft = useCallback((patch: Partial<EditDraft>): void => {
    setModal((m) => (m.kind === "edit" ? { kind: "edit", draft: { ...m.draft, ...patch } } : m));
  }, []);

  const onRefresh = useCallback(async (): Promise<void> => {
    await Promise.all([profiles.refresh(), profiles.refreshSyncStatus(), headed.refresh()]);
    setStatus("已刷新 Playwright 浏览器页。", "info");
  }, [headed, profiles, setStatus]);

  const onStop = useCallback((): void => {
    if (!window.zhizhu) return;
    void withTimeout(window.zhizhu.stopPlaywrightHeadedBrowser(), 35_000, "stop-headed")
      .then((r) => {
        if (!r.ok) {
          setStatus(r.error, "error");
          return;
        }
        setStatus("已请求停止可视化浏览器。", "info");
        void headed.refresh();
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`停止失败：${msg}`, "error");
      });
  }, [headed, setStatus]);

  const onForceSync = useCallback((): void => {
    if (!window.zhizhu) return;
    setForceSyncBusy(true);
    setStatus("正在向云端同步本机 Playwright 客户端配置…", "info");
    void withTimeout(window.zhizhu.forcePlaywrightShellSync(), 35_000, "force-pw-shell-sync")
      .then((r) => {
        if (r.ok) {
          setStatus(`客户端配置同步成功，已上行 ${r.sentProfileCount} 条。`, "info");
        } else if (r.skipped) {
          setStatus(`客户端配置同步未执行：${r.reason}`, "info");
        } else {
          const code = r.status === 0 ? "网络错误" : `HTTP ${r.status}`;
          setStatus(`客户端配置同步失败（${code}）：${r.message}`, "error");
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`客户端配置同步失败：${msg}`, "error");
      })
      .finally(() => {
        setForceSyncBusy(false);
        void profiles.refreshSyncStatus();
      });
  }, [profiles, setStatus]);

  const onCreate = useCallback((): void => {
    if (!window.zhizhu) return;
    void withTimeout(
      window.zhizhu.createPlaywrightBrowserProfile({
        slug: creatingSlug.trim(),
        label: creatingLabel.trim(),
        defaultStartPath: creatingPath.trim() ? creatingPath.trim() : undefined,
      }),
      20_000,
      "create-pw-profile",
    )
      .then((cr) => {
        if (!cr.ok) {
          setStatus(cr.error, "error");
          return;
        }
        setStatus(`已新建配置「${cr.profile.slug}」，可在控制台设备页查看云端登记（绑定设备并成功同步后）。`);
        setCreatingSlug("");
        setCreatingLabel("");
        setCreatingPath("");
        setModal({ kind: "closed" });
        void profiles.refresh();
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`创建失败：${msg}`, "error");
      });
  }, [creatingLabel, creatingPath, creatingSlug, profiles, setStatus]);

  const onOpenHeaded = useCallback(
    (id: string): void => {
      if (!window.zhizhu) return;
      void withTimeout(window.zhizhu.openPlaywrightHeadedBrowser(id), 120_000, "open-headed")
        .then((r) => {
          if (!r.ok) {
            setStatus(r.error, "error");
            return;
          }
          setStatus("已启动可视化 Chromium（就绪后状态将更新）。");
          void headed.refresh();
          void profiles.refresh();
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus(`打开失败：${msg}`, "error");
        });
    },
    [headed, profiles, setStatus],
  );

  const onSetDefault = useCallback(
    (id: string): void => {
      if (!window.zhizhu) return;
      void withTimeout(window.zhizhu.setDefaultPlaywrightBrowserProfile(id), 15_000, "pw-default")
        .then((dr) => {
          if (!dr.ok) {
            setStatus(dr.error, "error");
            return;
          }
          setStatus("已设为默认浏览器。", "info");
          void profiles.refresh();
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus(msg, "error");
        });
    },
    [profiles, setStatus],
  );

  const onDelete = useCallback(
    (id: string): void => {
      if (!window.zhizhu) return;
      if (
        !confirm(
          "删除该浏览器配置时会同时删除磁盘上的会话目录（Cookie 等）；云端登记将在下次同步时移除。确定删除？",
        )
      ) {
        return;
      }
      void withTimeout(window.zhizhu.deletePlaywrightBrowserProfile(id), 120_000, "delete-profile")
        .then((r) => {
          if (!r.ok) {
            setStatus(r.error, "error");
            return;
          }
          setModal((cur) => (cur.kind === "edit" && cur.draft.id === id ? { kind: "closed" } : cur));
          setStatus("已删除。");
          void profiles.refresh();
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus(`删除失败：${msg}`, "error");
        });
    },
    [profiles, setStatus],
  );

  const startEdit = (p: PlaywrightBrowserProfileRecord): void => {
    setModal({
      kind: "edit",
      draft: {
        id: p.id,
        label: p.label,
        slug: p.slug,
        defaultStartPath: p.defaultStartPath?.trim() ?? "",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  };

  const saveEdit = useCallback((): void => {
    if (!window.zhizhu || modal.kind !== "edit") return;
    const edit = modal.draft;
    const patch = {
      label: edit.label.trim(),
      newSlug: edit.slug.trim(),
      defaultStartPath: edit.defaultStartPath.trim().length > 0 ? edit.defaultStartPath.trim() : null,
    };
    void withTimeout(
      window.zhizhu.updatePlaywrightBrowserProfile({ profileId: edit.id, patch }),
      30_000,
      "pw-update-profile",
    )
      .then((ur) => {
        if (!ur.ok) {
          setStatus(ur.error, "error");
          return;
        }
        setStatus(`已保存「${ur.profile.slug}」`);
        setModal({ kind: "closed" });
        void profiles.refresh();
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`保存失败：${msg}`, "error");
      });
  }, [modal, profiles, setStatus]);

  const visualSessionLine = describeVisualSessions(headed);
  const syncLine = profiles.syncStatus
    ? describeClientConfigSyncStatus(profiles.syncStatus)
    : "客户端配置同步：加载中…";

  const modalOpen = modal.kind !== "closed";
  const modalTitle =
    modal.kind === "create" ? "新建浏览器配置" : modal.kind === "edit" ? "编辑本机浏览器配置" : "";

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="可视化浏览器状态"
        actions={
          <>
            <Button variant="ghost" onClick={() => void onRefresh()}>
              刷新列表
            </Button>
            <Button variant="secondary" onClick={onStop}>
              停止可视化 Chromium
            </Button>
            <Button
              variant="secondary"
              onClick={onForceSync}
              isLoading={forceSyncBusy}
              title="把本机所有 Playwright 配置整表上传到云端，覆盖该设备已登记行（需已绑定设备）"
            >
              立即同步到云端
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="zz-meta-line" aria-live="polite">
            {visualSessionLine}
          </p>
          <p className="zz-meta-line" aria-live="polite">
            {syncLine}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="已保存的浏览器配置"
        actions={
          <Button variant="primary" type="button" onClick={openCreateModal}>
            创建浏览器
          </Button>
        }
      >
        {profiles.errorMsg ? (
          <Banner kind="error">{profiles.errorMsg}</Banner>
        ) : profiles.loading && profiles.profiles.length === 0 ? (
          <p className="zz-meta-line">加载中…</p>
        ) : profiles.profiles.length === 0 ? (
          <Banner kind="info">暂无配置。请点击本卡片右上角「创建浏览器」添加。</Banner>
        ) : (
          <div className="flex flex-col gap-3">
            {profiles.profiles.map((p) => {
              const isDef = profiles.defaultProfileId === p.id;
              return (
                <article key={p.id} className="zz-pw-card">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="zz-pw-card-title">
                      {isDef ? <Pill tone="info">默认浏览器</Pill> : null}
                      <span className={isDef ? "ml-2" : ""}>{p.label}</span>
                    </h3>
                    <span className="zz-meta-line">浏览器环境标识：{p.slug}</span>
                  </header>
                  <p className="zz-meta-line mt-1">客户端内部编号（UUID）：{p.id}</p>
                  <p
                    className="zz-meta-line mt-1"
                    title={`创建时间 ${formatTs(p.createdAt)}；最近更新 ${formatTs(p.updatedAt)}`}
                  >
                    上次在客户端打开：{formatTs(p.lastOpenedAt)} · 默认起始：
                    {p.defaultStartPath?.trim().length ? p.defaultStartPath : "（控制台首页）"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => onOpenHeaded(p.id)}>
                      打开可视化浏览器
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isDef}
                      onClick={() => onSetDefault(p.id)}
                    >
                      {isDef ? "已是默认配置" : "设为默认浏览器"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                      编辑
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(p.id)}>
                      删除
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      <Modal open={modalOpen} onClose={closeModal} title={modalTitle}>
        {modal.kind === "create" ? (
          <div className="flex flex-col gap-3">
            <Field
              label="浏览器环境标识（Slug）"
              hint={(
                <span>
                  与将来任务参数 <code className="font-mono">browser_profile_slug</code> 同名；本机磁盘目录同名。
                </span>
              )}
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={creatingSlug}
                  onChange={(e) => setCreatingSlug(e.target.value)}
                  aria-describedby={describedBy}
                  placeholder="小写英文、数字、短横线与下划线（如 account-a、shop_01）"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field label="显示名称">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={creatingLabel}
                  onChange={(e) => setCreatingLabel(e.target.value)}
                  aria-describedby={describedBy}
                  placeholder="可使用中文备注，便于识别"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field
              label="默认起始地址（可选）"
              hint="例如控制台内相对路径 /tenant/… 或外链 https://…；留空则控制台首页"
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={creatingPath}
                  onChange={(e) => setCreatingPath(e.target.value)}
                  aria-describedby={describedBy}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" type="button" onClick={onCreate}>
                创建
              </Button>
              <Button variant="ghost" type="button" onClick={closeModal}>
                取消
              </Button>
            </div>
          </div>
        ) : null}

        {modal.kind === "edit" ? (
          <div className="flex flex-col gap-3">
            <p className="zz-meta-line text-sm">客户端内部编号（UUID）：{modal.draft.id}</p>
            <Field label="显示名称">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={modal.draft.label}
                  onChange={(e) => patchEditDraft({ label: e.target.value })}
                  aria-describedby={describedBy}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              label="浏览器环境标识（Slug，与本地持久目录同名）"
              hint="小写英文、数字、短横线与下划线（如 account-a、shop_01）"
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={modal.draft.slug}
                  onChange={(e) => patchEditDraft({ slug: e.target.value })}
                  aria-describedby={describedBy}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              label="默认起始地址（可选）"
              hint="例如 /tenant/app/… 或 https://… （留空则控制台首页）"
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  value={modal.draft.defaultStartPath}
                  onChange={(e) => patchEditDraft({ defaultStartPath: e.target.value })}
                  aria-describedby={describedBy}
                  autoComplete="off"
                />
              )}
            </Field>
            <p className="zz-meta-line">
              创建于 {formatTs(modal.draft.createdAt)} · 更新于 {formatTs(modal.draft.updatedAt)}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" type="button" onClick={saveEdit}>
                保存修改
              </Button>
              <Button variant="ghost" type="button" onClick={closeModal}>
                取消
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Banner kind="info">
        使用系统 Node 运行 <code className="font-mono">@zhizhu/runner</code> 的{" "}
        <code className="font-mono">headed-login</code>；须已安装 Playwright Chromium。同一时间仅允许打开一个可视化会话；托盘与菜单「Playwright
        可视化浏览器」可优先使用已设为默认的浏览器配置打开。
      </Banner>
    </div>
  );
}
