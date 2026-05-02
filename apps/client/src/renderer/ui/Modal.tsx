import type { ReactNode } from "react";
import { useEffect, useId } from "react";
import { cls } from "./cls";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

/**
 * 轻量遮罩弹层：点击底、Esc 关闭；需由调用方在 open 时控制焦点与内容。
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-black/40 p-0"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cls(
          "relative z-10 max-h-[min(90dvh,720px)] w-full max-w-lg min-w-0 overflow-y-auto rounded-2xl bg-white p-0 shadow-lg",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="zz-section-title border-b border-zz-border-light px-5 py-4">
          {title}
        </h2>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
