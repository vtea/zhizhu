import { Button } from "@/components/ui";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_MIN_WIDTH_PX = 144;

type VideoRowOpsCellProps = {
  placementOpsOk: boolean;
  placementDisabledTitle?: string;
  onPlacement: () => void;
  onEdit: () => void;
  onDelete: () => void;
  actionsDisabled: boolean;
  placementPending: boolean;
  deletePending: boolean;
};

export function VideoRowOpsCell({
  placementOpsOk,
  placementDisabledTitle,
  onPlacement,
  onEdit,
  onDelete,
  actionsDisabled,
  placementPending,
  deletePending,
}: VideoRowOpsCellProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(MENU_MIN_WIDTH_PX, menuRef.current?.offsetWidth ?? MENU_MIN_WIDTH_PX);
    const margin = 8;
    const gap = 4;
    const viewportW = window.innerWidth;

    // 从 ⋮ 左缘向右展开，避免盖住左侧「投放」按钮
    let left = rect.left;
    if (left + menuWidth > viewportW - margin) {
      left = Math.max(margin, viewportW - menuWidth - margin);
    }

    setMenuPos({ top: rect.bottom + gap, left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      return;
    }
    updateMenuPos();
  }, [menuOpen, updateMenuPos]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
    };
  }, [menuOpen, updateMenuPos]);

  function runAndClose(action: () => void) {
    setMenuOpen(false);
    action();
  }

  const menu =
    menuOpen && menuPos ? (
      <>
        <button
          type="button"
          tabIndex={-1}
          className="fixed inset-0 z-[100] cursor-default bg-transparent"
          aria-label="关闭菜单"
          onClick={() => setMenuOpen(false)}
        />
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="fixed z-[101] min-w-[9rem] rounded-lg border border-zz-border-light bg-zz-white py-1 shadow-lg ring-1 ring-black/[0.06]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-zz-near outline-none transition-colors hover:bg-zz-snow focus-visible:bg-zz-snow disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionsDisabled || placementPending}
            onClick={() => runAndClose(onEdit)}
          >
            编辑元数据
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-red-700 outline-none transition-colors hover:bg-red-50 focus-visible:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionsDisabled || deletePending}
            onClick={() => runAndClose(onDelete)}
          >
            删除
          </button>
        </div>
      </>
    ) : null;

  return (
    <>
      <div className="inline-flex max-w-full items-center justify-center gap-0.5">
        <Button
          variant="secondary"
          size="sm"
          className="!px-2 shrink-0"
          title={placementOpsOk ? undefined : placementDisabledTitle}
          disabled={actionsDisabled || !placementOpsOk || placementPending}
          onClick={onPlacement}
        >
          投放
        </Button>
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zz-muted outline-none transition-colors hover:bg-zz-snow hover:text-zz-near focus-visible:ring-2 focus-visible:ring-zz-blue/40 disabled:cursor-not-allowed disabled:opacity-50"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label="更多操作"
          disabled={actionsDisabled}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true" className="text-base leading-none">
            ⋮
          </span>
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
