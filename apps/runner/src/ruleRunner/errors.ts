/**
 * Rule Runner 的错误码白名单。CLI / IPC / Web 控制台审计共用同一字符串集合。
 *
 * 设计原则：
 * - error_code 是机器可读、跨语言稳定；message 是人类可读、可本地化。
 * - 不暴露任何脚本内部识别符（与 messageForBusinessError 同源理念）。
 */

export const RULE_ERROR_CODES = [
  "SELECTOR_NOT_FOUND",
  "SELECTOR_TIMEOUT",
  "NETWORK_PATTERN_TIMEOUT",
  "NAV_FAILED",
  "PLACEHOLDER_MISSING",
  "VALIDATION_FAILED",
  "RUNNER_INCOMPATIBLE",
  "USER_ACTION_REQUIRED",
  "STEP_TIMEOUT",
  "PAGE_CLOSED",
  "INTERNAL_ERROR",
] as const;

export type RuleErrorCode = (typeof RULE_ERROR_CODES)[number];

export class RuleError extends Error {
  readonly code: RuleErrorCode;
  readonly failedStep: number;
  readonly stepType: string | null;

  constructor(code: RuleErrorCode, failedStep: number, stepType: string | null, message: string) {
    super(message);
    this.name = "RuleError";
    this.code = code;
    this.failedStep = failedStep;
    this.stepType = stepType;
  }
}
