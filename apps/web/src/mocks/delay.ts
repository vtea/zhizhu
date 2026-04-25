export function mockLatencyMs(): number {
  const raw = import.meta.env.VITE_MOCK_LATENCY_MS;
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 120;
}

export async function sleepMock() {
  await new Promise((r) => setTimeout(r, mockLatencyMs()));
}
