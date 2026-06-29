import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthenticatedUserContext {
  userId: string;
  username: string;
  role: string;
  isSuperAdmin: boolean;
}

/** 当前请求关联的登录用户；首期仅承载超管身份。 */
export const authenticatedUserAls = new AsyncLocalStorage<AuthenticatedUserContext>();
