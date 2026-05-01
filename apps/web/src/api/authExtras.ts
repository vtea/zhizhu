import { apiPostJson } from "@/api/http";

export async function changeConsolePassword(body: { old_password: string; new_password: string }): Promise<void> {
  await apiPostJson<{ ok?: boolean }>("/api/v1/auth/change-password", body);
}
