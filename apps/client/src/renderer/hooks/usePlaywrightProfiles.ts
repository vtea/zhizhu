import { useCallback, useEffect, useState } from "react";
import type { PlaywrightBrowserProfileRecord, PlaywrightShellSyncStatusDto } from "../../sharedTypes";
import { withTimeout } from "../utils";

export type PlaywrightProfilesState = {
  loading: boolean;
  errorMsg: string | null;
  profiles: PlaywrightBrowserProfileRecord[];
  defaultProfileId: string | null;
  syncStatus: PlaywrightShellSyncStatusDto | null;
  refresh: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
};

export function usePlaywrightProfiles(enabled: boolean): PlaywrightProfilesState {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<PlaywrightBrowserProfileRecord[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<PlaywrightShellSyncStatusDto | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.zhizhu) return;
    setLoading(true);
    try {
      const r = await withTimeout(
        window.zhizhu.listPlaywrightBrowserProfiles(),
        15_000,
        "list-playwright-profiles",
      );
      if (!r.ok) {
        setErrorMsg(r.error);
        setProfiles([]);
        setDefaultProfileId(null);
        return;
      }
      const sorted = [...r.profiles].sort((a, b) => (a.slug > b.slug ? 1 : a.slug < b.slug ? -1 : 0));
      setProfiles(sorted);
      setDefaultProfileId(r.defaultProfileId);
      setErrorMsg(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSyncStatus = useCallback(async (): Promise<void> => {
    if (!window.zhizhu) return;
    try {
      const s = await withTimeout(
        window.zhizhu.getPlaywrightShellSyncStatus(),
        8_000,
        "pw-shell-sync-status",
      );
      setSyncStatus(s);
    } catch {
      setSyncStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    void refreshSyncStatus();
  }, [enabled, refresh, refreshSyncStatus]);

  return { loading, errorMsg, profiles, defaultProfileId, syncStatus, refresh, refreshSyncStatus };
}
