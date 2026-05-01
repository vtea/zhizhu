import * as fs from "node:fs";
import * as path from "node:path";
import type { RuleBody } from "@zhizhu/playwright-rule-schema";

export interface FileRuleBundle {
  ruleDir: string;
  ruleBody: RuleBody;
  meta: Record<string, unknown>;
  mapping: Record<string, unknown>;
}

export function loadFileRuleBundle(ruleDirRaw: string): FileRuleBundle {
  const ruleDir = path.resolve(ruleDirRaw);
  const ruleJsonPath = path.join(ruleDir, "rule.json");
  const metaJsonPath = path.join(ruleDir, "meta.json");
  const mappingJsonPath = path.join(ruleDir, "mapping.json");
  if (!fs.existsSync(ruleJsonPath)) {
    throw new Error(`缺少 rule.json: ${ruleJsonPath}`);
  }
  if (!fs.existsSync(metaJsonPath)) {
    throw new Error(`缺少 meta.json: ${metaJsonPath}`);
  }
  const ruleBody = JSON.parse(fs.readFileSync(ruleJsonPath, "utf8")) as RuleBody;
  const meta = JSON.parse(fs.readFileSync(metaJsonPath, "utf8")) as Record<string, unknown>;
  const mapping = fs.existsSync(mappingJsonPath)
    ? (JSON.parse(fs.readFileSync(mappingJsonPath, "utf8")) as Record<string, unknown>)
    : {};
  return { ruleDir, ruleBody, meta, mapping };
}

/**
 * 仅读取 meta.json / mapping.json（不要求存在），供 stdin 已带 rule_body + file_rule_dir 时补上 console_base 等。
 */
export function loadOptionalFileRuleSidecars(ruleDirRaw: string): {
  meta: Record<string, unknown>;
  mapping: Record<string, unknown>;
} {
  const ruleDir = path.resolve(ruleDirRaw);
  const metaJsonPath = path.join(ruleDir, "meta.json");
  const mappingJsonPath = path.join(ruleDir, "mapping.json");
  let meta: Record<string, unknown> = {};
  let mapping: Record<string, unknown> = {};
  if (fs.existsSync(metaJsonPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaJsonPath, "utf8")) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  if (fs.existsSync(mappingJsonPath)) {
    try {
      mapping = JSON.parse(fs.readFileSync(mappingJsonPath, "utf8")) as Record<string, unknown>;
    } catch {
      mapping = {};
    }
  }
  return { meta, mapping };
}
