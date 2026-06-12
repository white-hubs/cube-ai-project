/**
 * DescriptorLoader：目录扫描 + Nacos（group `agentic-engine-tools`）加载 Tool Descriptor。
 *
 * Phase 3 P3-11：
 *   - Nacos index（YAML）列出 dataId → 逐条拉取 YAML/JSON → Zod 校验
 *   - 失败 warn + 跳过；成功注册到 DescriptorRegistry（快照替换）
 *   - 轮询 index md5 变化 → 全量 reload → `descriptor.reload` EventTarget
 *
 * R24：Nacos HTTP 仅在 start() / 轮询时发出，不在模块 import 期连接。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@dangao/bun-server';
import { ToolDescriptor } from '@cube-ai/contracts';
import { NacosConfigClient } from '@dangao/nacos-client';
import { parse as parseYaml } from 'yaml';
import type { SkillDescriptor } from '@tachu/core';
import { DescriptorRegistryService } from './descriptor-registry.service';
import {
  ENGINE_BUILTIN_TOOL_NAMES,
  ensureBuiltinCurrentDateDescriptor,
  ensureBuiltinImageQwenDescriptor,
  ensureBuiltinPlatformToolDescriptors,
} from './engine-builtin-descriptors';
import { extractDescriptorDocumentParts } from './descriptor-document-parser';
import { RuleRegistryService, type RuleDescriptor } from './rule-registry.service';
import { SkillRegistryService } from './skill-registry.service';
import {
  createNacosClientFromEnv,
  TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN,
  type ToolEffectiveVersionSource,
} from './tool-effective-version.provider';

const LOG_PREFIX = '[DescriptorLoader]';

/** 热更通知：监听 `descriptor.reload`。 */
export const DESCRIPTOR_RELOAD_EVENT = 'descriptor.reload';

function warn(msg: string): void {
  console.warn(`${LOG_PREFIX} ${msg}`);
}

function info(msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function skillTriggerLabel(skill: SkillDescriptor): string {
  return skill.trigger?.type ?? 'semantic';
}

function describeSkill(skill: SkillDescriptor): string {
  const version = skill.version ?? '0.0.0';
  const resources = skill.resources?.length ?? 0;
  const tags = skill.tags && skill.tags.length > 0 ? skill.tags.join(',') : '-';
  return (
    `${skill.name}@${version}` +
    ` trigger=${skillTriggerLabel(skill)}` +
    ` tags=${tags}` +
    ` resources=${resources}` +
    ` instructionsChars=${skill.instructions.length}` +
    ` sourceDir=${skill.sourceDir ?? '<unset>'}`
  );
}

/** 文件名等于 19 位 SFID 的 agent descriptor，视为 dev/联调占位（详见承接文档 §4） */
function isDevPlaceholderAgentName(name: string): boolean {
  return /^\d{19}$/.test(name);
}

function parseStructuredContent(raw: string, hintPath: string): unknown {
  const t = raw.trim();
  if (t.startsWith('{')) {
    return JSON.parse(t) as unknown;
  }
  return parseYaml(raw) as unknown;
}

function parseIndexDataIds(content: string): string[] {
  const doc = parseYaml(content) as unknown;
  if (!doc || typeof doc !== 'object') return [];
  const root = doc as Record<string, unknown>;
  const ids =
    root['dataIds'] ??
    root['descriptors'] ??
    root['items'];
  if (Array.isArray(ids)) {
    return ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

function readOptionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeSkillTrigger(
  raw: unknown,
  skillName: string,
  hintPath: string,
): SkillDescriptor['trigger'] {
  const type =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object'
        ? (raw as { type?: unknown }).type
        : undefined;
  if (type === 'always' || type === 'semantic' || type === 'explicit') {
    return { type };
  }
  if (type === 'keyword' || type === 'custom') {
    warn(
      `skill ${skillName} (${hintPath}) uses deprecated trigger.type=${type}; using semantic`,
    );
  }
  return { type: 'semantic' };
}

function parseSkillResources(raw: unknown): SkillDescriptor['resources'] {
  if (!Array.isArray(raw)) return undefined;
  const resources: NonNullable<SkillDescriptor['resources']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const path = readOptionalString(rec, 'path');
    const type = rec['type'];
    if (!path) continue;
    if (type !== 'script' && type !== 'reference' && type !== 'asset') continue;
    const loadHint = readOptionalString(rec, 'loadHint');
    resources.push({
      path,
      type,
      ...(loadHint !== undefined ? { loadHint } : {}),
    });
  }
  return resources.length > 0 ? resources : undefined;
}

function parseSkillDescriptorFromRecord(
  rec: Record<string, unknown>,
  instructions: string,
  sourceDir: string,
  hintPath: string,
): SkillDescriptor {
  const name = readOptionalString(rec, 'name');
  const description = readOptionalString(rec, 'description');
  if (!name) throw new Error('skill descriptor requires non-empty name');
  if (!description) throw new Error(`skill ${name} requires non-empty description`);

  return {
    kind: 'skill',
    name,
    description,
    instructions: instructions.trim(),
    trigger: normalizeSkillTrigger(rec['trigger'], name, hintPath),
    sourceDir,
    ...(readOptionalString(rec, 'version') !== undefined
      ? { version: readOptionalString(rec, 'version') }
      : {}),
    ...(readOptionalString(rec, 'displayName') !== undefined
      ? { displayName: readOptionalString(rec, 'displayName') }
      : {}),
    ...(rec['deprecated'] === true ? { deprecated: true } : {}),
    ...(readOptionalString(rec, 'deprecatedMessage') !== undefined
      ? { deprecatedMessage: readOptionalString(rec, 'deprecatedMessage') }
      : {}),
    ...(Array.isArray(rec['tags'])
      ? { tags: rec['tags'].filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(Array.isArray(rec['requires'])
      ? { requires: rec['requires'] as SkillDescriptor['requires'] }
      : {}),
    ...(parseSkillResources(rec['resources']) !== undefined
      ? { resources: parseSkillResources(rec['resources']) }
      : {}),
  };
}

function parseSkillMarkdown(raw: string, sourceDir: string, hintPath: string): SkillDescriptor {
  // frontmatter 提取统一走 DescriptorDocumentParser seam（ADR-0018 §5）
  const { record, body } = extractDescriptorDocumentParts(raw);
  return parseSkillDescriptorFromRecord(record, body, sourceDir, hintPath);
}

/** `descriptors/rules/*.yaml`（kind: rule）→ RuleDescriptor；缺 name/content 抛错。 */
function parseRuleDescriptorContent(raw: string, hintPath: string): RuleDescriptor {
  const parsed = parseStructuredContent(raw, hintPath);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('rule descriptor must be an object');
  }
  const rec = parsed as Record<string, unknown>;
  if (rec['kind'] !== 'rule') {
    throw new Error('rule descriptor kind must be rule');
  }
  const name = readOptionalString(rec, 'name');
  if (!name) throw new Error('rule descriptor requires non-empty name');
  const content =
    typeof rec['content'] === 'string' && rec['content'].trim().length > 0
      ? rec['content'].trim()
      : undefined;
  if (!content) throw new Error(`rule ${name} requires non-empty content`);

  return {
    kind: 'rule',
    name,
    content,
    ...(readOptionalString(rec, 'version') !== undefined
      ? { version: readOptionalString(rec, 'version') }
      : {}),
    ...(readOptionalString(rec, 'description') !== undefined
      ? { description: readOptionalString(rec, 'description') }
      : {}),
    ...(readOptionalString(rec, 'displayName') !== undefined
      ? { displayName: readOptionalString(rec, 'displayName') }
      : {}),
    ...(Array.isArray(rec['tags'])
      ? { tags: rec['tags'].filter((x): x is string => typeof x === 'string') }
      : {}),
  };
}

function parseLegacySkillDescriptor(
  raw: string,
  sourceDir: string,
  hintPath: string,
): SkillDescriptor {
  const parsed = parseStructuredContent(raw, hintPath);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('legacy skill descriptor must be an object');
  }
  const rec = parsed as Record<string, unknown>;
  if (rec['kind'] !== 'skill') {
    throw new Error('legacy skill descriptor kind must be skill');
  }
  const instructions = readOptionalString(rec, 'instructions') ?? '';
  return parseSkillDescriptorFromRecord(rec, instructions, sourceDir, hintPath);
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code?: unknown }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw e;
  }
}

@Injectable()
export class DescriptorLoader {
  readonly reloadEvents = new EventTarget();
  private readonly agentIndex = new Map<string, string>();
  private readonly agentCache = new Map<string, Record<string, unknown>>();
  private globalPrompt = '';

  private nacosConfig: NacosConfigClient | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private lastIndexFingerprint = '';
  private started = false;

  constructor(
    private readonly registry: DescriptorRegistryService,
    @Inject(TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN)
    private readonly pinSource: ToolEffectiveVersionSource,
    private readonly skillRegistry?: SkillRegistryService,
    private readonly ruleRegistry?: RuleRegistryService,
  ) {}

  /** 外部下发的引擎内置工具与本地内置冲突时丢弃并告警（内置在 apply 末尾 ensure）。 */
  private filterReservedToolDescriptors(descriptors: ToolDescriptor[]): ToolDescriptor[] {
    const reserved = new Set<string>(ENGINE_BUILTIN_TOOL_NAMES);
    return descriptors.filter((d) => {
      if (reserved.has(d.name)) {
        warn(
          `ignoring external ToolDescriptor ${d.name}@${d.version ?? '1.0.0'} — engine builtin takes precedence`,
        );
        return false;
      }
      return true;
    });
  }

  /** 快照替换 + 保证 `currentDate` 内置描述符存在。 */
  private applyToolDescriptorBatch(descriptors: ToolDescriptor[]): void {
    const filtered = this.filterReservedToolDescriptors(descriptors);
    if (filtered.length > 0) {
      try {
        this.registry.replaceAllFromSnapshot(filtered);
      } catch (e) {
        warn(`replaceAllFromSnapshot failed: ${(e as Error).message}`);
      }
    } else if (descriptors.length > 0) {
      warn(
        'descriptor batch contained only reserved builtin names (e.g. currentDate); skipping replaceAllFromSnapshot',
      );
    }
    ensureBuiltinCurrentDateDescriptor(this.registry);
    ensureBuiltinImageQwenDescriptor(this.registry);
    ensureBuiltinPlatformToolDescriptors(this.registry);
  }

  /**
   * 进程启动后调用：连接 Nacos（lazy HTTP）、首轮加载、启动轮询。
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const core = createNacosClientFromEnv();
    this.nacosConfig = core ? new NacosConfigClient(core) : null;

    const skillDir = this.configuredSkillDir();
    const agentDir =
      process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR?.trim() ||
      join(process.cwd(), 'descriptors', 'agents');
    const toolDir = process.env.AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR?.trim();
    const pollMs = Number(
      process.env.AGENTIC_ENGINE_DESCRIPTOR_POLL_MS ?? '15000',
    );
    info(
      `startup descriptor loading begin cwd=${process.cwd()} ` +
        `globalPrompt=${process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH?.trim() || join(process.cwd(), 'CUBE.md')} ` +
        `agentDir=${agentDir} skillDir=${skillDir} ` +
        `toolDir=${toolDir || '<disabled>'} nacos=${this.nacosConfig ? 'enabled' : 'disabled'} ` +
        `pollMs=${this.nacosConfig ? pollMs : 0}`,
    );

    const promptPath =
      process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH?.trim() ||
      join(process.cwd(), 'CUBE.md');
    await this.loadGlobalPrompt(promptPath);

    const agentResult = await this.buildAgentIndexFromDir(agentDir);
    info(`agent descriptor index complete dir=${agentDir} indexed=${agentResult.indexed} skipped=${agentResult.skipped}`);
    this.reportDevAgentPlaceholders();

    await this.loadSkillsFromDir(skillDir);
    await this.loadRulesFromDir(this.configuredRuleDir());

    if (toolDir) {
      const toolResult = await this.loadFromDir(toolDir);
      info(`local tool descriptor loading complete dir=${toolDir} loaded=${toolResult.loaded} skipped=${toolResult.skipped}`);
    }

    if (this.nacosConfig) {
      await this.loadFromNacosInternal({ force: true });
      await this.pinSource?.refreshFromNacos?.();

      if (pollMs > 0) {
        this.pollHandle = setInterval(() => {
          this.loadFromNacosInternal({ force: false }).catch((e) =>
            warn(`poll reload failed: ${(e as Error).message}`),
          );
        }, pollMs);
      }
    }

    ensureBuiltinCurrentDateDescriptor(this.registry);
    ensureBuiltinImageQwenDescriptor(this.registry);
    ensureBuiltinPlatformToolDescriptors(this.registry);
    info('startup descriptor loading complete');
  }

  /** 优雅停止轮询（供未来 lifecycle 使用）。 */
  stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * 扫描 `descriptors/agents` 目录，仅建立 name->path 索引（不做递归 hydrate）。
   * 用于会话创建时的 lazy `getAgent(name)` 前置。
   */
  async buildAgentIndexFromDir(dir: string): Promise<{ indexed: number; skipped: number }> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      warn(`cannot readdir agents dir ${dir}: ${(e as Error).message}`);
      return { indexed: 0, skipped: 0 };
    }

    const supported = ['.yaml', '.yml', '.json'];
    const files = entries.filter((f) => supported.includes(extname(f).toLowerCase()));
    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const parsed = parseStructuredContent(content, fullPath);
        if (!parsed || typeof parsed !== 'object') {
          skipped++;
          continue;
        }
        const rec = parsed as Record<string, unknown>;
        if (rec['kind'] !== 'agent') {
          skipped++;
          continue;
        }
        const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
        if (!name) {
          skipped++;
          continue;
        }
        this.agentIndex.set(name, fullPath);
        indexed++;
      } catch (e) {
        warn(`skip invalid agent descriptor file ${file}: ${(e as Error).message}`);
        skipped++;
      }
    }

    return { indexed, skipped };
  }

  getIndexedAgentPath(name: string): string | undefined {
    return this.agentIndex.get(name);
  }

  /**
   * 启动护栏：列出名为 19 位 SFID 的 dev 占位 agent。
   *  - DEPLOY_ENV=DEV 时打 INFO，便于联调者一眼看到当前可用的 agentId；
   *  - 非 DEV（含 TEST/STAGING/PROD）时打 WARN，提醒占位 yaml 不应进入更高
   *    环境（与承接文档 §4 一致：真生产 agent 由 ghcloud AI 中台下发）。
   *
   * ref: docs/technical-design/plans/2026-05-12-engine-ghcloud-chat-loop-handoff.zh.md §4
   */
  private reportDevAgentPlaceholders(): void {
    const placeholders: string[] = [];
    for (const name of this.agentIndex.keys()) {
      if (isDevPlaceholderAgentName(name)) placeholders.push(name);
    }
    if (placeholders.length === 0) return;

    placeholders.sort();
    const env = (process.env.DEPLOY_ENV ?? '').toUpperCase();
    const isDev = env === 'DEV' || env === 'DEVELOPMENT' || env === '';
    const list = placeholders.join(', ');
    if (isDev) {
      info(
        `Loaded ${placeholders.length} dev-only agent descriptor(s) keyed by SFID: [${list}] ` +
          `— used for local Web/H5 chat loop integration; remove these YAMLs once the AI middle platform delivers real agents.`,
      );
    } else {
      warn(
        `Detected ${placeholders.length} dev-only agent descriptor(s) keyed by SFID under DEPLOY_ENV=${env || '<unset>'}: [${list}] ` +
          `— these placeholders should not be deployed beyond DEV; remove them from descriptors/agents/.`,
      );
    }
  }

  async loadIndexedAgentDescriptor(name: string): Promise<Record<string, unknown> | null> {
    const cached = this.agentCache.get(name);
    if (cached) return cached;
    const path = this.agentIndex.get(name);
    if (!path) return null;
    try {
      const text = await readFile(path, 'utf-8');
      const parsed = parseStructuredContent(text, path);
      if (!parsed || typeof parsed !== 'object') return null;
      const rec = parsed as Record<string, unknown>;
      this.agentCache.set(name, rec);
      return rec;
    } catch (e) {
      warn(`cannot load indexed agent ${name}: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Lazy `getAgent(name)` 入口：优先内存缓存，未命中时按索引读取并缓存。
   */
  async getAgent(name: string): Promise<Record<string, unknown> | null> {
    return this.loadIndexedAgentDescriptor(name);
  }

  async loadGlobalPrompt(path: string): Promise<string> {
    try {
      const text = await readFile(path, 'utf-8');
      this.globalPrompt = text;
      info(`global prompt loaded path=${path} chars=${text.length}`);
      return text;
    } catch (e) {
      warn(`cannot read global prompt ${path}: ${(e as Error).message}`);
      this.globalPrompt = '';
      return '';
    }
  }

  getGlobalPrompt(): string {
    return this.globalPrompt;
  }

  private configuredSkillDir(): string {
    return (
      process.env.AGENTIC_ENGINE_SKILL_DESCRIPTOR_DIR?.trim() ||
      join(process.cwd(), 'descriptors', 'skills')
    );
  }

  private configuredRuleDir(): string {
    return (
      process.env.AGENTIC_ENGINE_RULE_DESCRIPTOR_DIR?.trim() ||
      join(process.cwd(), 'descriptors', 'rules')
    );
  }

  async loadRulesFromConfiguredDir(): Promise<{ loaded: number; skipped: number }> {
    return this.loadRulesFromDir(this.configuredRuleDir());
  }

  /**
   * 扫描 `descriptors/rules` 目录（kind: rule YAML/JSON）进 RuleRegistry。
   * session 创建时 `ruleRefs`（裸 name）经该注册表水合进 snapshot.rules（ADR-0016 §7）。
   */
  async loadRulesFromDir(dir: string): Promise<{ loaded: number; skipped: number }> {
    if (!this.ruleRegistry) {
      warn(`rule registry unavailable; skip rule loading dir=${dir}`);
      return { loaded: 0, skipped: 0 };
    }

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      warn(`cannot readdir rules dir ${dir}: ${(e as Error).message}`);
      return { loaded: 0, skipped: 0 };
    }

    const supported = ['.yaml', '.yml', '.json'];
    const files = entries.filter((f) => supported.includes(extname(f).toLowerCase()));
    let loaded = 0;
    let skipped = 0;
    const rules: RuleDescriptor[] = [];

    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        const content = await readFile(fullPath, 'utf-8');
        rules.push(parseRuleDescriptorContent(content, fullPath));
        loaded++;
      } catch (e) {
        warn(`skip invalid rule descriptor file ${file}: ${(e as Error).message}`);
        skipped++;
      }
    }

    this.ruleRegistry.replaceAllFromSnapshot(rules);
    info(
      `rule descriptor scan complete dir=${dir} loaded=${loaded} skipped=${skipped} ` +
        `registrySize=${this.ruleRegistry.size()} latest=[${this.ruleRegistry
          .list()
          .map((r) => `${r.name}@${r.version ?? '0.0.0'}`)
          .join(', ')}]`,
    );
    return { loaded, skipped };
  }

  async loadSkillsFromConfiguredDir(): Promise<{ loaded: number; skipped: number }> {
    return this.loadSkillsFromDir(this.configuredSkillDir());
  }

  async loadSkillsFromDir(dir: string): Promise<{ loaded: number; skipped: number }> {
    if (!this.skillRegistry) {
      warn(`skill registry unavailable; skip skill loading dir=${dir}`);
      return { loaded: 0, skipped: 0 };
    }

    info(`skill descriptor scan begin dir=${dir}`);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      warn(`cannot readdir skills dir ${dir}: ${(e as Error).message}`);
      return { loaded: 0, skipped: 0 };
    }

    let loaded = 0;
    let skipped = 0;
    const skills: SkillDescriptor[] = [];

    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const skillMdPath = join(skillDir, 'SKILL.md');
      try {
        const markdown = await readOptionalFile(skillMdPath);
        if (markdown !== undefined) {
          const skill = parseSkillMarkdown(markdown, skillDir, skillMdPath);
          skills.push(skill);
          info(`loaded skill descriptor file=${skillMdPath} ${describeSkill(skill)}`);
          loaded++;
          continue;
        }
      } catch (e) {
        warn(`skip invalid skill ${entry}/SKILL.md: ${(e as Error).message}`);
        skipped++;
        continue;
      }

      let legacyLoaded = false;
      for (const descriptorName of ['descriptor.yaml', 'descriptor.yml', 'descriptor.json']) {
        const descriptorPath = join(skillDir, descriptorName);
        try {
          const raw = await readOptionalFile(descriptorPath);
          if (raw === undefined) continue;
          const skill = parseLegacySkillDescriptor(raw, skillDir, descriptorPath);
          skills.push(skill);
          info(`loaded legacy skill descriptor file=${descriptorPath} ${describeSkill(skill)}`);
          loaded++;
          legacyLoaded = true;
          break;
        } catch (e) {
          warn(`skip invalid skill ${entry}/${descriptorName}: ${(e as Error).message}`);
          skipped++;
          legacyLoaded = true;
          break;
        }
      }
      if (!legacyLoaded) skipped++;
    }

    this.skillRegistry.replaceAllFromSnapshot(skills);
    const signature = this.skillRegistry.signature();
    const finalSkills = this.skillRegistry.list();
    info(
      `skill descriptor scan complete dir=${dir} loaded=${loaded} skipped=${skipped} ` +
        `registrySize=${this.skillRegistry.size()} latest=[${finalSkills
          .map((skill) => `${skill.name}@${skill.version ?? '0.0.0'}:${skillTriggerLabel(skill)}`)
          .join(', ')}] signature=${shortHash(signature)}`,
    );
    return { loaded, skipped };
  }

  /**
   * 扫描目录下所有 .yaml / .yml / .json 文件，解析为 ToolDescriptor 并注册。
   */
  async loadFromDir(dir: string): Promise<{ loaded: number; skipped: number }> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      warn(`cannot readdir ${dir}: ${(e as Error).message}`);
      return { loaded: 0, skipped: 0 };
    }

    const supported = ['.yaml', '.yml', '.json'];
    const files = entries.filter((f) => supported.includes(extname(f).toLowerCase()));

    let loaded = 0;
    let skipped = 0;
    const batch: ToolDescriptor[] = [];

    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const parsed = parseStructuredContent(content, fullPath);
        const descriptor = ToolDescriptor.parse(parsed);
        batch.push(descriptor);
        loaded++;
      } catch (e) {
        warn(`skip invalid descriptor file ${file}: ${(e as Error).message}`);
        skipped++;
      }
    }

    if (batch.length > 0) {
      this.applyToolDescriptorBatch(batch);
    }

    info(`tool descriptor scan complete dir=${dir} loaded=${loaded} skipped=${skipped}`);

    return { loaded, skipped };
  }

  private async loadFromNacosInternal(opts: { force: boolean }): Promise<void> {
    const client = this.nacosConfig;
    if (!client) return;

    const group =
      process.env.AGENTIC_ENGINE_DESCRIPTOR_GROUP?.trim() ||
      'agentic-engine-tools';
    const indexId =
      process.env.AGENTIC_ENGINE_DESCRIPTOR_INDEX_DATA_ID?.trim() ||
      'descriptor-index.yaml';

    let indexContent: string;
    let fingerprint: string;
    try {
      const idx = await client.getConfig({ dataId: indexId, groupName: group });
      indexContent = idx.content ?? '';
      fingerprint = `${idx.md5 ?? ''}:${idx.lastModified ?? ''}`;
    } catch (e) {
      warn(`Nacos index fetch failed (${indexId}): ${(e as Error).message}`);
      return;
    }

    if (!opts.force && fingerprint === this.lastIndexFingerprint) {
      return;
    }
    this.lastIndexFingerprint = fingerprint;

    let dataIds = parseIndexDataIds(indexContent);
    const extra = process.env.AGENTIC_ENGINE_DESCRIPTOR_DATA_IDS?.trim();
    if (extra) {
      dataIds = [...new Set([...dataIds, ...extra.split(',').map((s) => s.trim()).filter(Boolean)])];
    }

    if (dataIds.length === 0) {
      warn(`index ${indexId} produced no dataIds`);
      return;
    }
    info(
      `Nacos descriptor index loaded group=${group} index=${indexId} dataIds=${dataIds.length} fingerprint=${fingerprint || '<empty>'}`,
    );

    const descriptors: ToolDescriptor[] = [];

    for (const dataId of dataIds) {
      try {
        const res = await client.getConfig({ dataId, groupName: group });
        const raw = res.content ?? '';
        const parsed = parseStructuredContent(raw, dataId);
        const descriptor = ToolDescriptor.parse(parsed);
        descriptors.push(descriptor);
        info(`loaded Nacos tool descriptor dataId=${dataId} ${descriptor.name}@${descriptor.version ?? '1.0.0'}`);
      } catch (e) {
        warn(`skip invalid Nacos descriptor dataId=${dataId}: ${(e as Error).message}`);
      }
    }

    if (descriptors.length === 0) {
      warn('no valid descriptors after Nacos fetch');
      return;
    }

    this.applyToolDescriptorBatch(descriptors);
    await this.loadSkillsFromConfiguredDir();
    await this.loadRulesFromConfiguredDir();
    await this.pinSource?.refreshFromNacos?.();
    info(`Nacos descriptor reload complete tools=${descriptors.length}`);

    this.reloadEvents.dispatchEvent(new CustomEvent(DESCRIPTOR_RELOAD_EVENT));
  }
}
