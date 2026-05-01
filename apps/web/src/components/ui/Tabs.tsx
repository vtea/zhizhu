import type { ReactNode } from "react";
import { useId } from "react";
import { cls } from "./cls";

export type TabItem<V extends string> = {
  value: V;
  label: ReactNode;
  ariaLabel?: string;
};

type TabsProps<V extends string> = {
  items: TabItem<V>[];
  value: V;
  onChange: (next: V) => void;
  /** 用于 aria-label，默认「分区」。 */
  label?: string;
  className?: string;
  /** 由调用方负责渲染 tabpanel；本组件提供 idFor() 拼接 aria-controls。 */
  idFor?: (v: V) => string;
};

export function Tabs<V extends string>({ items, value, onChange, label = "分区", className, idFor }: TabsProps<V>) {
  const groupId = useId();
  return (
    <div role="tablist" aria-label={label} className={cls("zz-tabs", className)}>
      {items.map((it) => {
        const selected = it.value === value;
        const tabId = `${groupId}-tab-${it.value}`;
        const panelId = idFor?.(it.value);
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            aria-label={it.ariaLabel}
            className="zz-tab"
            onClick={() => onChange(it.value)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

type TabPanelProps = {
  /** 与 Tabs 的 idFor() 对齐。 */
  id: string;
  /** 关联的 tab id（aria-labelledby）。 */
  labelledBy?: string;
  active: boolean;
  className?: string;
  children: ReactNode;
};

export function TabPanel({ id, labelledBy, active, className, children }: TabPanelProps) {
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
      tabIndex={0}
      className={cls("focus:outline-none", className)}
    >
      {active ? children : null}
    </section>
  );
}
