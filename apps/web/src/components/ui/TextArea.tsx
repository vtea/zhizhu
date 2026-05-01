import type { TextareaHTMLAttributes } from "react";
import { cls } from "./cls";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  hasError?: boolean;
  mono?: boolean;
};

export function TextArea({ hasError, mono, className, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={cls("zz-input", mono ? "zz-input-mono" : null, hasError ? "zz-input-error" : null, className)}
      aria-invalid={hasError || undefined}
      {...rest}
    />
  );
}
