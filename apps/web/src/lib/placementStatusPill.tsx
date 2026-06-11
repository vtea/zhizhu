import { Pill, type PillTone } from "@/components/ui/Pill";

const PLACEMENT_STATUS_ACTIVE = "投放中";
const PLACEMENT_STATUS_REVIEW = "需要复盘";
const PLACEMENT_STATUS_STOPPED = "停止投放";

function resolvePlacementStatusPill(status: string | null | undefined): { tone: PillTone; label: string } {
  const trimmed = status?.trim() ?? "";
  if (trimmed === "") {
    return { tone: "neutral", label: "—" };
  }
  if (trimmed === PLACEMENT_STATUS_ACTIVE) {
    return { tone: "success", label: PLACEMENT_STATUS_ACTIVE };
  }
  if (trimmed === PLACEMENT_STATUS_REVIEW) {
    return { tone: "warn", label: PLACEMENT_STATUS_REVIEW };
  }
  if (trimmed === PLACEMENT_STATUS_STOPPED) {
    return { tone: "neutral", label: PLACEMENT_STATUS_STOPPED };
  }
  return { tone: "neutral", label: trimmed };
}

export function PlacementStatusPill({ status }: { status: string | null | undefined }) {
  const { tone, label } = resolvePlacementStatusPill(status);
  return (
    <Pill tone={tone} className="shrink-0 px-1.5 py-0 text-[11px] leading-5" title={label === "—" ? "暂无投放记录" : label}>
      {label}
    </Pill>
  );
}
