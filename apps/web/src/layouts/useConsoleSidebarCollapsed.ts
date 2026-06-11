import { useCallback, useState } from "react";

const STORAGE_KEY = "zhizhu:console-sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useConsoleSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(readCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { collapsed, setCollapsed, toggleCollapsed };
}
