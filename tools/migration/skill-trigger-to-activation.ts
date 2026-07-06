/**
 * 一次性数据迁移：租户 skill descriptor content `trigger` → `activation`（tachu rc.13）。
 *
 * rc.13 把四类描述符的激活轴统一为 `activation`（`always|manual|semantic|path`），彻底
 * 移除旧 `trigger` 词汇（无兼容层）。wire schema `TenantSkillContentSchema` 已改为 `activation`，
 * 但**已入库**的租户 skill content（`tenant_descriptors.draft_content_json` 与
 * `tenant_descriptor_versions.content_json`，kind='skill'）里可能仍是旧 `trigger` 字符串。
 *
 * 本脚本把它们就地改写为 `activation`（值映射：explicit→manual，always/semantic 同名，
 * 其余/未知→semantic），并删除 `trigger`。幂等：已是 `activation` 的行不动；无 `trigger`
 * 也无 `activation` 的旧行**不改**（读取侧回落 semantic）。
 *
 * cutover 后可删除（与 catalog-migrate 同属 tools/migration 一次性资产）。
 *
 * 用法：
 *   bun tools/migration/skill-trigger-to-activation.ts --dry-run
 *   bun tools/migration/skill-trigger-to-activation.ts --mysql-url mysql://user:pass@host:3306/db
 */

export type ActivationMode = "always" | "manual" | "semantic" | "path";
export interface Activation {
  mode: ActivationMode;
  globs?: string[];
}

const LEGACY_TRIGGER_TO_MODE: Record<string, ActivationMode> = {
  always: "always",
  semantic: "semantic",
  explicit: "manual",
};

/** 旧 `trigger`（字符串或 `{ type }` 对象）→ 新 `activation`；未知/缺省回落 semantic。 */
export function mapLegacyTriggerToActivation(trigger: unknown): Activation {
  const type =
    typeof trigger === "string" ? trigger : trigger && typeof trigger === "object" ? (trigger as { type?: unknown }).type : undefined;
  const mode = typeof type === "string" && type in LEGACY_TRIGGER_TO_MODE ? LEGACY_TRIGGER_TO_MODE[type]! : "semantic";
  return { mode };
}

/**
 * 纯转换：把一条 skill content 的 `trigger` 就地改写为 `activation`。
 * - 已有合法 `activation`：仅删除残留 `trigger`（若有），mode 不动。
 * - 有 `trigger` 无 `activation`：按映射生成 `activation`，删除 `trigger`。
 * - 无 `trigger` 无 `activation`：不动（changed=false，读取侧回落 semantic）。
 */
export function migrateSkillContentTriggerToActivation(content: unknown): { content: unknown; changed: boolean } {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { content, changed: false };
  }
  const rec = content as Record<string, unknown>;
  const hasTrigger = "trigger" in rec;
  const hasActivation = rec["activation"] != null && typeof rec["activation"] === "object" && !Array.isArray(rec["activation"]);
  if (!hasTrigger) {
    return { content, changed: false };
  }
  const next: Record<string, unknown> = { ...rec };
  if (!hasActivation) {
    next["activation"] = mapLegacyTriggerToActivation(rec["trigger"]);
  }
  delete next["trigger"];
  return { content: next, changed: true };
}

// ── DB runner ────────────────────────────────────────────────────────────────

export interface MigrateMysqlPool {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

export interface SkillActivationMigrateResult {
  dryRun: boolean;
  scanned: { heads: number; versions: number };
  changed: { heads: number; versions: number };
}

interface HeadRow {
  id: string;
  tenant: number;
  draft_content_json: unknown;
}
interface VersionRow {
  descriptor_id: string;
  tenant: number;
  version_no: number;
  content_json: unknown;
}

function parseJsonColumn(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export async function migrateSkillTriggerToActivationInMysql(
  pool: MigrateMysqlPool,
  opts: { dryRun: boolean },
): Promise<SkillActivationMigrateResult> {
  const result: SkillActivationMigrateResult = {
    dryRun: opts.dryRun,
    scanned: { heads: 0, versions: 0 },
    changed: { heads: 0, versions: 0 },
  };

  // 1) draft head content（kind='skill'）
  const [headRowsRaw] = await pool.query(
    `SELECT id, tenant, draft_content_json FROM tenant_descriptors WHERE kind = 'skill' AND deleted = 0`,
  );
  const headRows = (headRowsRaw as HeadRow[]) ?? [];
  for (const row of headRows) {
    result.scanned.heads += 1;
    const parsed = parseJsonColumn(row.draft_content_json);
    const { content, changed } = migrateSkillContentTriggerToActivation(parsed);
    if (!changed) continue;
    result.changed.heads += 1;
    if (!opts.dryRun) {
      await pool.query(`UPDATE tenant_descriptors SET draft_content_json = CAST(? AS JSON) WHERE id = ? AND tenant = ?`, [
        JSON.stringify(content ?? {}),
        row.id,
        row.tenant,
      ]);
    }
  }

  // 2) 版本历史 content（append-only，join skill descriptor）
  const [versionRowsRaw] = await pool.query(
    `SELECT v.descriptor_id, v.tenant, v.version_no, v.content_json
       FROM tenant_descriptor_versions v
       JOIN tenant_descriptors d ON d.id = v.descriptor_id AND d.tenant = v.tenant
      WHERE d.kind = 'skill'`,
  );
  const versionRows = (versionRowsRaw as VersionRow[]) ?? [];
  for (const row of versionRows) {
    result.scanned.versions += 1;
    const parsed = parseJsonColumn(row.content_json);
    const { content, changed } = migrateSkillContentTriggerToActivation(parsed);
    if (!changed) continue;
    result.changed.versions += 1;
    if (!opts.dryRun) {
      await pool.query(
        `UPDATE tenant_descriptor_versions SET content_json = CAST(? AS JSON)
          WHERE descriptor_id = ? AND tenant = ? AND version_no = ?`,
        [JSON.stringify(content ?? {}), row.descriptor_id, row.tenant, row.version_no],
      );
    }
  }

  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseSkillActivationCliArgs(argv: string[]): { dryRun: boolean; mysqlUrl?: string } {
  let dryRun = false;
  let mysqlUrl: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--mysql-url" && argv[i + 1]) {
      mysqlUrl = argv[++i];
    }
  }
  return { dryRun, mysqlUrl };
}

async function main(): Promise<void> {
  const { dryRun, mysqlUrl } = parseSkillActivationCliArgs(process.argv.slice(2));
  const url = mysqlUrl ?? process.env["AGENTIC_ENGINE_MYSQL_URL"]?.trim();
  if (!url) {
    console.error(
      "Usage: bun tools/migration/skill-trigger-to-activation.ts [--dry-run] [--mysql-url mysql://user:pass@host:3306/db]\n" +
        "（或设置环境变量 AGENTIC_ENGINE_MYSQL_URL）",
    );
    process.exit(1);
  }
  const mysql = (await import("mysql2/promise")).default;
  const pool = mysql.createPool({ bigNumberStrings: true, supportBigNumbers: true, uri: url });
  try {
    const result = await migrateSkillTriggerToActivationInMysql(pool as unknown as MigrateMysqlPool, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
