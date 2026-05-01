/** 极简 className 拼接：过滤掉空/false/undefined。与 apps/web 同源接口。 */
export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((x): x is string => typeof x === "string" && x.length > 0).join(" ");
}
