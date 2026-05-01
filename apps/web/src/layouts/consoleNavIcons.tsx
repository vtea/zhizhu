import type { ReactNode, SVGAttributes } from "react";

/** 24×24 线性图标，`currentColor`，外层 `size-4` */
export type ConsoleNavIconId =
  | "dashboard"
  | "recommendedVideos"
  | "videos"
  | "leads"
  | "adPlacements"
  | "automationRules"
  | "taskCenter"
  | "staffAccounts"
  | "deviceBinding"
  | "systemSettings"
  | "tenantManagement";

const s = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  fill: "none",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ConsoleNavIcon({
  icon,
  className,
  "aria-hidden": ariaHidden = true,
  ...rest
}: Omit<SVGAttributes<SVGSVGElement>, "children"> & { icon: ConsoleNavIconId; className?: string }) {
  const base = `size-4 shrink-0 ${className ?? ""}`;

  const wrap = (children: ReactNode) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role="img"
      className={base}
      aria-hidden={ariaHidden}
      {...rest}
    >
      {children}
    </svg>
  );

  switch (icon) {
    case "dashboard":
      return wrap(
        <>
          <rect {...s} x="3" y="3" width="8.75" height="8.75" rx="1.25" />
          <rect {...s} x="13.75" y="3" width="7.25" height="8.75" rx="1.25" />
          <rect {...s} x="3" y="14.25" width="18.5" height="6.75" rx="1.25" />
        </>,
      );
    case "recommendedVideos":
      return wrap(
        <>
          {/* 四角十字「推荐」感 */}
          <path {...s} d="M12 3v4 M12 17v4 M17 12h4 M3 12h4" />
          <path {...s} d="m7.75 18.75-2 2 M18.25 5.75l2-2 M5.75 7.75l2-2m10.75 13.5 2 2 M7.07 14.93l-.75.88m11.93-14.93.75-.88" />
        </>,
      );
    case "videos":
      return wrap(
        <>
          <rect {...s} x="2.5" y="6" width="14" height="12" rx="1.75" />
          <polygon {...s} strokeLinejoin="miter" points="17 9 21.75 12 17 15" />
        </>,
      );
    case "leads":
      return wrap(
        <>
          <circle {...s} cx="9.75" cy="9" r="4" />
          <path {...s} d="M4 20.5v-.5a5 5 0 0 1 5.5-4.985A5 5 0 0 1 15 20v.75" />
        </>,
      );
    case "adPlacements":
      return wrap(
        <>
          <path {...s} d="M21 21V8l-6 3.5v9.5 Z" />
          <path {...s} d="M3 15.5V5.5L15 2v19" />
        </>,
      );
    case "automationRules":
      return wrap(
        <>
          <circle {...s} cx="6" cy="7" r="2.25" />
          <circle {...s} cx="18" cy="16" r="2.25" />
          <path {...s} d="M8.25 7.25c3.5 1.5 5.5 5.25 6.25 8.5" />
        </>,
      );
    case "taskCenter":
      return wrap(
        <>
          <rect {...s} x="6" y="4" width="12" height="17" rx="2" />
          <path {...s} d="M9 8.5h6 M9 12h6 M9 15.5h4.5" />
        </>,
      );
    case "staffAccounts":
      return wrap(
        <>
          <circle {...s} cx="9" cy="9" r="3.25" />
          <path {...s} d="M3.5 20a5.5 5.5 0 0 1 10.5-1.75" />
          <circle {...s} cx="17" cy="10" r="2.5" />
        </>,
      );
    case "deviceBinding":
      return wrap(
        <>
          <rect {...s} x="7" y="3" width="10" height="18" rx="2.5" />
          <path {...s} d="M10 19.5h4" />
        </>,
      );
    case "systemSettings":
      return wrap(
        <>
          <path {...s} d="M4 7.5h8M5.5 7.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" />
          <path {...s} d="M12 16.5h8M16.5 16.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" />
          <path {...s} d="M4 12h5M6.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" />
        </>,
      );
    case "tenantManagement":
      return wrap(
        <>
          <path {...s} d="M3 21V10.5L9 7.5v13.5" />
          <path {...s} d="M9 21V6l6-3v18" />
          <path {...s} d="M15 14.5h6V21" />
        </>,
      );
    default:
      return wrap(<circle {...s} cx="12" cy="12" r="8" />);
  }
}
