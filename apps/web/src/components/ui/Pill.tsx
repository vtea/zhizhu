import type { HTMLAttributes, ReactNode } from "react";
import { cls } from "./cls";

export type PillTone = "neutral" | "info" | "warn" | "success" | "danger";

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  children: ReactNode;
};

const TONE: Record<PillTone, string> = {
  neutral: "zz-pill-neutral",
  info: "zz-pill-info",
  warn: "zz-pill-warn",
  success: "zz-pill-success",
  danger: "zz-pill-danger",
};

export function Pill({ tone = "neutral", className, children, ...rest }: PillProps) {
  return (
    <span className={cls("zz-pill", TONE[tone], className)} {...rest}>
      {children}
    </span>
  );
}
