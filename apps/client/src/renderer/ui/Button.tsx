import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cls } from "./cls";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
export type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  fullWidth?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "zz-btn-primary",
  secondary: "zz-btn-secondary",
  danger: "zz-btn-danger",
  ghost: "zz-btn-ghost",
  link: "zz-btn-link",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "zz-btn-sm",
  md: "zz-btn-md",
};

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  leftIcon,
  fullWidth = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isLink = variant === "link";
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cls(
        "zz-btn",
        VARIANT[variant],
        isLink ? null : SIZE[size],
        fullWidth ? "zz-btn-block" : null,
        className,
      )}
      {...rest}
    >
      {isLoading ? <span className="zz-btn-spinner" aria-hidden="true" /> : leftIcon}
      <span>{children}</span>
    </button>
  );
}
