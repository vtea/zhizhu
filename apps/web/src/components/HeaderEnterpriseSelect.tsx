import type { VisibleLeadsEnterpriseRow } from "@/api/consoleExtras";
import { cls } from "@/components/ui/cls";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PANEL_MAX_WIDTH_PX = 320;
const VIEWPORT_MARGIN_PX = 8;

function enterpriseLabel(e: VisibleLeadsEnterpriseRow): string {
  return e.display_name?.trim() || e.dy_leads_enterprise_id;
}

function enterpriseFullTitle(e: VisibleLeadsEnterpriseRow): string {
  const name = e.display_name?.trim();
  return name ? `${name}（${e.dy_leads_enterprise_id}）` : e.dy_leads_enterprise_id;
}

type HeaderEnterpriseSelectProps = {
  id?: string;
  enterprises: VisibleLeadsEnterpriseRow[];
  value: string | null;
  onChange: (dyLeadsEnterpriseId: string | null) => void;
  disabled?: boolean;
};

export function HeaderEnterpriseSelect({
  id: idProp,
  enterprises,
  value,
  onChange,
  disabled = false,
}: HeaderEnterpriseSelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listboxId = `${id}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = enterprises.find((e) => sameDyLeadsEnterpriseId(e.dy_leads_enterprise_id, value ?? ""));
  const triggerLabel = selected ? enterpriseLabel(selected) : "全部主体";
  const triggerTitle = selected ? enterpriseFullTitle(selected) : "全部主体";

  const updatePanelPos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(
      PANEL_MAX_WIDTH_PX,
      Math.max(rect.width, panelRef.current?.offsetWidth ?? rect.width),
      window.innerWidth - VIEWPORT_MARGIN_PX * 2,
    );
    const gap = 4;
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - VIEWPORT_MARGIN_PX) {
      left = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - panelWidth - VIEWPORT_MARGIN_PX);
    }
    setPanelPos({ top: rect.bottom + gap, left, width: panelWidth });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPos();
  }, [open, updatePanelPos, enterprises.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePanelPos);
    window.addEventListener("scroll", updatePanelPos, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePanelPos);
      window.removeEventListener("scroll", updatePanelPos, true);
    };
  }, [open, updatePanelPos]);

  function pick(next: string | null) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const panel =
    open && panelPos ? (
      <>
        <button
          type="button"
          tabIndex={-1}
          className="fixed inset-0 z-[100] cursor-default bg-transparent"
          aria-label="关闭主体列表"
          onClick={() => setOpen(false)}
        />
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          aria-label="主体列表"
          className="fixed z-[101] max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-zz-border-light bg-zz-white py-1 shadow-lg ring-1 ring-black/[0.06]"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={cls(
              "block w-full truncate px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-zz-snow focus-visible:bg-zz-snow",
              !value ? "bg-zz-blue-soft font-medium text-zz-blue" : "text-zz-near",
            )}
            title="全部主体"
            onClick={() => pick(null)}
          >
            全部主体
          </button>
          {enterprises.map((e) => {
            const selectedItem = sameDyLeadsEnterpriseId(e.dy_leads_enterprise_id, value ?? "");
            return (
              <button
                key={e.dy_leads_enterprise_id}
                type="button"
                role="option"
                aria-selected={selectedItem}
                className={cls(
                  "block w-full truncate px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-zz-snow focus-visible:bg-zz-snow",
                  selectedItem ? "bg-zz-blue-soft font-medium text-zz-blue" : "text-zz-near",
                )}
                title={enterpriseFullTitle(e)}
                onClick={() => pick(e.dy_leads_enterprise_id)}
              >
                {enterpriseLabel(e)}
              </button>
            );
          })}
        </div>
      </>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={cls(
          "zz-input zz-input-select min-w-0 w-full truncate py-1.5 shadow-sm",
          disabled && "cursor-not-allowed opacity-60",
        )}
        aria-label="按主体筛选经营数据"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={triggerTitle}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((v) => !v);
        }}
      >
        {triggerLabel}
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
