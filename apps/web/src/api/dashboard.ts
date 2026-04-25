import { getApiBaseUrl } from "@/api/env";
import { type AnalyticsFilters, inInteractionWindow } from "@/api/analytics-filters";
import { apiGetJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockLeads, mockVideos, MOCK_TENANT } from "@/mocks/seed";

export type LeadTrendPoint = { date: string; open: number; converted: number };

export type AccountBreakdownRow = {
  account_id: string;
  display_name: string | null;
  leads: number;
  videos: number;
  plays: number;
};

export type DashboardSummary = {
  tenant_id: string;
  leads_total: number;
  leads_open: number;
  leads_converted: number;
  videos_total: number;
  plays_total: number;
  last_refreshed_at: string;
  lead_trend?: LeadTrendPoint[];
  account_breakdown?: AccountBreakdownRow[];
};

function filterLeadsForKpi(
  f: AnalyticsFilters,
): (typeof mockLeads)[number][] {
  return mockLeads.filter((l) => {
    if (f.accountId && l.account_id !== f.accountId) {
      return false;
    }
    return inInteractionWindow(l.dy_last_interaction_at, f.from, f.to);
  });
}

function filterVideosForKpi(
  f: AnalyticsFilters,
): (typeof mockVideos)[number][] {
  return mockVideos.filter((v) => {
    if (f.accountId && v.account_id !== f.accountId) {
      return false;
    }
    const pub = v.dy_publish_at;
    if (f.from || f.to) {
      if (!pub) {
        return false;
      }
      return inInteractionWindow(pub, f.from, f.to);
    }
    return true;
  });
}

function mockLeadTrend(leads: (typeof mockLeads)[number][]): LeadTrendPoint[] {
  const byDate = new Map<string, { open: number; converted: number }>();
  for (const l of leads) {
    const d = l.dy_last_interaction_at?.slice(0, 10) ?? "—";
    const cur = byDate.get(d) ?? { open: 0, converted: 0 };
    if (l.lead_stage === "converted") {
      cur.converted += 1;
    } else {
      cur.open += 1;
    }
    byDate.set(d, cur);
  }
  return [...byDate.entries()]
    .filter(([k]) => k !== "—")
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, v]) => ({ date, open: v.open, converted: v.converted }));
}

function mockAccountBreakdown(
  leads: (typeof mockLeads)[number][],
  videos: (typeof mockVideos)[number][],
): AccountBreakdownRow[] {
  const ids = new Set<string>();
  for (const l of leads) {
    ids.add(l.account_id);
  }
  for (const v of videos) {
    ids.add(v.account_id);
  }
  return [...ids].map((account_id) => {
    const lc = leads.filter((x) => x.account_id === account_id).length;
    const vs = videos.filter((x) => x.account_id === account_id);
    const plays = vs.reduce((s, x) => s + (x.dy_play_count ?? 0), 0);
    return {
      account_id,
      display_name: null,
      leads: lc,
      videos: vs.length,
      plays,
    };
  });
}

export async function getDashboardSummary(tenantId: string, filters: AnalyticsFilters): Promise<DashboardSummary> {
  const base = getApiBaseUrl();
  if (base) {
    const qs = new URLSearchParams();
    if (filters.accountId) {
      qs.set("account_id", filters.accountId);
    }
    if (filters.from) {
      qs.set("from", filters.from);
    }
    if (filters.to) {
      qs.set("to", filters.to);
    }
    const q = qs.toString();
    return apiGetJson<DashboardSummary>(
      `/api/v1/tenants/${encodeURIComponent(tenantId)}/dashboard/summary${q ? `?${q}` : ""}`,
    );
  }
  await sleepMock();
  if (tenantId !== MOCK_TENANT) {
    return {
      tenant_id: tenantId,
      leads_total: 0,
      leads_open: 0,
      leads_converted: 0,
      videos_total: 0,
      plays_total: 0,
      last_refreshed_at: new Date().toISOString(),
      lead_trend: [],
      account_breakdown: [],
    };
  }
  const leadsF = filterLeadsForKpi(filters);
  const vidsF = filterVideosForKpi(filters);
  const leads_open = leadsF.filter((l) => l.lead_stage === "no_conversion").length;
  const leads_converted = leadsF.filter((l) => l.lead_stage === "converted").length;
  const plays_total = vidsF.reduce((s, v) => s + (v.dy_play_count ?? 0), 0);
  return {
    tenant_id: tenantId,
    leads_total: leadsF.length,
    leads_open,
    leads_converted,
    videos_total: vidsF.length,
    plays_total,
    last_refreshed_at: new Date().toISOString(),
    lead_trend: mockLeadTrend(leadsF),
    account_breakdown: mockAccountBreakdown(leadsF, vidsF),
  };
}
