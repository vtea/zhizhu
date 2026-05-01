import type { HTMLAttributes, ReactNode } from "react";
import { cls } from "./cls";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** 默认 section；若需 div/article 等可重写。 */
  as?: "section" | "div" | "article";
  flush?: boolean;
  children?: ReactNode;
};

export function Card({ as = "section", flush = false, className, children, ...rest }: CardProps) {
  const Tag = as as "section";
  return (
    <Tag className={cls(flush ? "zz-card-flush" : "zz-card", className)} {...rest}>
      {children}
    </Tag>
  );
}
