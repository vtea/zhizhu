import type { InputHTMLAttributes } from "react";
import { cls } from "./cls";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  hasError?: boolean;
  mono?: boolean;
};

export function TextInput({ hasError, mono, className, type = "text", ...rest }: TextInputProps) {
  return (
    <input
      type={type}
      className={cls("zz-input", mono ? "zz-input-mono" : null, hasError ? "zz-input-error" : null, className)}
      aria-invalid={hasError || undefined}
      {...rest}
    />
  );
}
