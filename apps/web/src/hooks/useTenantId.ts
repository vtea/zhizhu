import { isValidTenantSlug } from "@/lib/tenantSlug";
import { useParams } from "react-router-dom";

export function useTenantId(): string {
  const { tenantId } = useParams();
  const raw = (tenantId ?? "").trim().toLowerCase();
  if (!raw || !isValidTenantSlug(raw)) {
    throw new Error("路由缺少有效 tenantId");
  }
  return raw;
}
