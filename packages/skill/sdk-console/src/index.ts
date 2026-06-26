import { SkillConsoleClientImpl } from './client';
import type { SkillConsoleConfig, SkillConsoleSseEvent } from './http';
import {
  skillConsoleRequestJson as skillConsoleRequestJsonValue,
  skillConsoleStreamSse as skillConsoleStreamSseValue,
} from './http';

export type {
  SkillCategory,
  SkillCategoryCode,
  SkillItem,
  UserSkillRelation,
  SkillBrowseOptions,
  SkillContentInput,
  SkillDescriptorView,
  SkillLibraryItemView,
  SkillShelfEntryView,
  SkillInstallRequest,
  SkillVersion,
  SkillUpdateCheckResult,
} from './types';

export type {
  SkillProposeRequest,
  SkillProposeOptions,
  SkillProposeResult,
} from './client';

export {
  SKILL_CATEGORY_MAP,
  SKILL_CATEGORY_REVERSE_MAP,
} from './types';

export type { SkillConsoleConfig, SkillConsoleSseEvent } from './http';

const skillConsoleRequestJson = skillConsoleRequestJsonValue;
const skillConsoleStreamSse = skillConsoleStreamSseValue;

export class SkillConsoleClient extends SkillConsoleClientImpl {}

export function createSkillConsoleClient(config: SkillConsoleConfig): SkillConsoleClient {
  return new SkillConsoleClient(config);
}

export {
  skillConsoleRequestJson,
  skillConsoleStreamSse,
};
