import type { SelectHTMLAttributes } from "react";
import { cls } from "./cls";

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  hasError?: boolean;
};

export function SelectInput({ hasError, className, children, ...rest }: SelectInputProps) {
  return (
    <select
      className={cls("zz-input", hasError ? "zz-input-error" : null, className)}
      aria-invalid={hasError || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}
