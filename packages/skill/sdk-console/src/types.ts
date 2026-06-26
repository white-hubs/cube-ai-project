/**
 * Skill categories for AI skill center
 */
export type SkillCategory = "数据查询" | "工作执行" | "分析汇报" | "知识咨询" | "智能提醒";

/**
 * Skill category codes for API usage
 */
export type SkillCategoryCode = "DATA_QUERY" | "WORK_EXECUTION" | "ANALYSIS_REPORT" | "KNOWLEDGE_CONSULT" | "INTELLIGENT_REMIND";

/**
 * Category mapping between display name and code
 */
export const SKILL_CATEGORY_MAP: Record<SkillCategory, SkillCategoryCode> = {
  数据查询: "DATA_QUERY",
  工作执行: "WORK_EXECUTION",
  分析汇报: "ANALYSIS_REPORT",
  知识咨询: "KNOWLEDGE_CONSULT",
  智能提醒: "INTELLIGENT_REMIND",
};

/**
 * Reverse category mapping
 */
export const SKILL_CATEGORY_REVERSE_MAP: Record<SkillCategoryCode, SkillCategory> = {
  DATA_QUERY: "数据查询",
  WORK_EXECUTION: "工作执行",
  ANALYSIS_REPORT: "分析汇报",
  KNOWLEDGE_CONSULT: "知识咨询",
  INTELLIGENT_REMIND: "智能提醒",
};

/**
 * Skill item in library or my skills
 */
export interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  categoryCode: SkillCategoryCode;
  version: string;
  isBuiltin: boolean;
  published: boolean;
  intro?: string;

  // Six required configurations (R1-R5 required, R6 optional)
  /** R1: Usage examples - user input -> AI output pairs */
  usageExample?: string;
  /** R2: Output specification - format template and quality standards */
  outputSpec?: string;
  /** R3: Input requirements - required and optional info items */
  inputReq?: string;
  /** R4: Pitfall guide - common errors and correct practices */
  pitfallGuide?: string;
  /** R5: Self-check checklist - items to verify before output */
  checklist?: string;
  /** R6: Reference resources - templates, manuals, documents (optional) */
  reference?: string;

  // Creation metadata
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

/**
 * User's skill relation (my skills)
 */
export interface UserSkillRelation {
  skillId: string;
  addedAt: string;
  localVersion: string;
  hasUpdate: boolean;
  latestVersion?: string;
  source: "builtin" | "published" | "authored";
}

/**
 * Skill library browse options
 */
export interface SkillBrowseOptions {
  q?: string;
  category?: SkillCategoryCode;
  tier?: "system" | "tenant";
}

/**
 * Skill create/update request body
 */
export interface SkillContentInput {
  name: string;
  description: string;
  category: SkillCategoryCode;
  intro?: string;
  published?: boolean;

  // Six configurations
  usageExample?: string;
  outputSpec?: string;
  inputReq?: string;
  pitfallGuide?: string;
  checklist?: string;
  reference?: string;
}

/**
 * Skill create/update response
 */
export interface SkillDescriptorView {
  id: string;
  name: string;
  content: SkillContentInput & {
    version?: string;
    isBuiltin?: boolean;
  };
  status: "draft" | "published";
  headVersionNo: number;
  publishedVersionNo?: number | null;
  hasUnpublishedChanges?: boolean;
  createTime: number;
  updateTime: number;
}

/**
 * Library skill item view
 */
export interface SkillLibraryItemView {
  ref: string;
  kind: "skill";
  displayName?: string;
  description?: string;
  category?: SkillCategory;
  categoryCode?: SkillCategoryCode;
  tags?: string[];
  tier: "system" | "tenant";
  sharedVersionNo?: number;
  content?: unknown;
}

/**
 * Skill shelf entry (my skills)
 */
export interface SkillShelfEntryView {
  id: string;
  targetKind: "skill";
  targetId: string;
  source: "authored" | "ref" | "copy";
  pinVersionNo?: number | null;
  enabled: boolean;
  displayName?: string;
  effectiveVersionNo?: number | null;
  runnableStatus: "runnable" | "disabled" | "unresolvable";
}

/**
 * Install skill to my shelf request
 */
export interface SkillInstallRequest {
  ref: string;
  displayName?: string;
}

/**
 * Skill version info
 */
export interface SkillVersion {
  versionNo: number;
  version: string;
  createdAt: string;
  createdBy?: string;
  changes?: string;
}

/**
 * Check skill update result
 */
export interface SkillUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  latestVersionNo?: number;
}
