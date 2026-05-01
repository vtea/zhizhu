import { useEffect } from "react";
import { cls } from "./cls";
import { SectionCard } from "./SectionCard";
import type { SectionCardProps } from "./SectionCard";

type OverlaySectionCardProps = Omit<
  SectionCardProps,
  /** Rendered internally with dialog semantics */
  "flush"
> & {
  /** When false, renders nothing */
  open: boolean;
  onClose: () => void;
  /** Backdrop + panel z-index (default aligns with StaffAccounts edit dialog) */
  zClass?: string;
  ariaLabelledBy?: string;
  overlayClassName?: string;
};

/**
 * Full-viewport backdrop + centered `SectionCard` for create/edit flows.
 * Backdrop mouse-down closes; Escape closes (when open).
 */
export function OverlaySectionCard({
  open,
  onClose,
  zClass = "z-[140]",
  className,
  overlayClassName,
  ariaLabelledBy,
  children,
  ...sectionCardProps
}: OverlaySectionCardProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : (typeof sectionCardProps.title === "string" ? sectionCardProps.title : sectionCardProps.ariaLabel)}
      className={cls(
        "fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/35 px-4 py-12 sm:items-center sm:py-8",
        zClass,
        overlayClassName,
      )}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) {
          onClose();
        }
      }}
    >
      <SectionCard
        {...sectionCardProps}
        className={cls(
          "w-full max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto border border-zz-border-light bg-zz-white shadow-2xl ring-1 ring-black/[0.04] sm:max-w-2xl",
          className,
        )}
      >
        {children}
      </SectionCard>
    </div>
  );
}
