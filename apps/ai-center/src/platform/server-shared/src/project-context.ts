import { AsyncLocalStorage } from 'node:async_hooks'

export type ProjectContext = {
  projectId: string
  /** 为 true 时允许查询链路跳过 project 过滤，供超管全局视图使用。 */
  bypassProjectIsolation?: boolean
}

/** 当前请求关联的 project（管理面来自 X-Project-Id；执行面来自 api_keys.project_id）。 */
export const projectContextAls = new AsyncLocalStorage<ProjectContext>()
