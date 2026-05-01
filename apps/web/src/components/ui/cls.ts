/** 极简 className 拼接：过滤掉空/false/undefined，避免引入 clsx 等三方依赖。 */
export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((x): x is string => typeof x === "string" && x.length > 0).join(" ");
}
