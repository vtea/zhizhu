import { ApiError } from "@/api/http";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "@/routes/router";
import "@/styles/index.css";

function queryShouldNotRetryOnError(error: unknown): boolean {
  if (error instanceof ApiError) {
    const s = error.status;
    /** 5xx：同参重试通常无意义，且会加倍打挂掉或迁移中的服务 */
    if (s >= 500) {
      return true;
    }
    /**
     * 4xx：语义/鉴权/校验类错误，同参重试几乎不会变好；401/429 等亦不宜马上再打一次。
     * 例外 408：偶发可再试（保留默认最多 1 次重试）。
     */
    if (s >= 400 && s < 500) {
      return s !== 408;
    }
  }
  return false;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) => {
        if (queryShouldNotRetryOnError(error)) {
          return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      /** 与 queries 一致：鉴权/冲突/限流等不要重试；且 401 后可能已清 session，重试会误打。 */
      retry: (failureCount, error) => {
        if (queryShouldNotRetryOnError(error)) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
