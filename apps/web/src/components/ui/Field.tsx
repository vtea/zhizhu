import type { ReactNode } from "react";
import { useId } from "react";
import { cls } from "./cls";

type FieldProps = {
  label: ReactNode;
  /** 函数版子节点：将分配好的 id 与 aria-describedby 注入到自定义控件上。 */
  children: ((props: { id: string; describedBy: string | undefined }) => ReactNode) | ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** 默认会用 useId 自动生成；当外部需要稳定 id 时可显式传入。 */
  id?: string;
  className?: string;
};

export function Field({ label, children, hint, error, required, id, className }: FieldProps) {
  const autoId = useId();
  const ctrlId = id ?? autoId;
  const hintId = hint ? `${ctrlId}-hint` : undefined;
  const errorId = error ? `${ctrlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cls("zz-field", className)}>
      <label
        className={cls("zz-field-label", required ? "zz-field-label-required" : null)}
        htmlFor={ctrlId}
      >
        {label}
      </label>
      {typeof children === "function" ? children({ id: ctrlId, describedBy }) : children}
      {hint ? (
        <span id={hintId} className="zz-field-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="zz-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
