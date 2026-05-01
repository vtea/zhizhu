import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_PREFIX = "zz-console-dy-leads-enterprise:";

export type SelectedEnterpriseContextValue = {
  selectedDyLeadsEnterpriseId: string | null;
  setSelectedDyLeadsEnterpriseId: (id: string | null) => void;
};

const SelectedEnterpriseContext = createContext<SelectedEnterpriseContextValue | null>(null);

export function SelectedEnterpriseProvider({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const storageKey = `${STORAGE_PREFIX}${tenantId}`;

  const [selectedDyLeadsEnterpriseId, setState] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw?.trim() || null;
    } catch {
      return null;
    }
  });

  const setSelectedDyLeadsEnterpriseId = useCallback(
    (id: string | null) => {
      const next = id?.trim() || null;
      setState(next);
      try {
        if (!next) {
          sessionStorage.removeItem(storageKey);
        } else {
          sessionStorage.setItem(storageKey, next);
        }
      } catch {
        /* ignore quota / private mode */
      }
    },
    [storageKey],
  );

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      setState(raw?.trim() || null);
    } catch {
      setState(null);
    }
  }, [storageKey]);

  const value = useMemo(
    (): SelectedEnterpriseContextValue => ({
      selectedDyLeadsEnterpriseId,
      setSelectedDyLeadsEnterpriseId,
    }),
    [selectedDyLeadsEnterpriseId, setSelectedDyLeadsEnterpriseId],
  );

  return <SelectedEnterpriseContext.Provider value={value}>{children}</SelectedEnterpriseContext.Provider>;
}

export function useSelectedEnterprise(): SelectedEnterpriseContextValue {
  const ctx = useContext(SelectedEnterpriseContext);
  if (!ctx) {
    throw new Error("useSelectedEnterprise must be used within SelectedEnterpriseProvider");
  }
  return ctx;
}
