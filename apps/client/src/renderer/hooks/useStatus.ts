import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type StatusKind = "info" | "error";
export type StatusState = { msg: string; kind: StatusKind };
export type SetStatus = (msg: string, kind?: StatusKind) => void;

type StatusContextValue = {
  state: StatusState;
  setStatus: SetStatus;
};

const StatusContext = createContext<StatusContextValue | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StatusState>({ msg: "", kind: "info" });
  const setStatus = useCallback<SetStatus>((msg, kind = "info") => {
    setState({ msg, kind });
  }, []);
  const value = useMemo<StatusContextValue>(() => ({ state, setStatus }), [state, setStatus]);
  return createElement(StatusContext.Provider, { value }, children);
}

export function useStatus(): StatusContextValue {
  const v = useContext(StatusContext);
  if (!v) {
    throw new Error("useStatus must be used inside StatusProvider");
  }
  return v;
}
