import { HttpException, Inject, Injectable, NotFoundException } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "@cube-ai/ai-center/platform/server-base";

import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from "../db/repository-contracts";
import { LangflowClient, LangflowRequestError, langflowConfigFromAppConfig } from "../langflow/langflow-client";
import { FlowCrudService } from "./flow-crud.service";

export interface FlowFileDownloadOptions {
  returnContent?: boolean;
}

function cloneDownloadResponse(res: Response): Response {
  const h = new Headers();
  for (const key of ["content-type", "content-disposition", "content-length", "cache-control", "etag", "last-modified"]) {
    const v = res.headers.get(key);
    if (v) {
      h.set(key, v);
    }
  }
  return new Response(res.body, { headers: h, status: res.status, statusText: res.statusText });
}

function trimStringArray(items: string[]): string[] {
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 文件接口门面：对外提供 Cube 文件 API，内部适配执行后端的 v1 flow 文件和 v2 用户文件。 */
@Injectable()
export class FlowFilesService {
  private readonly lf: LangflowClient | null;

  constructor(
    @Inject(APP_CONFIG_TOKEN) config: AppConfig,
    @Inject(FLOW_REPOSITORY_TOKEN) private readonly repo: FlowRepository,
    private readonly crud: FlowCrudService,
  ) {
    const cfg = langflowConfigFromAppConfig(config);
    this.lf = cfg ? new LangflowClient(cfg) : null;
  }

  private requireClient(): LangflowClient {
    if (!this.lf) {
      throw new HttpException(503, "Execution backend not configured", { code: "EXECUTION_UNAVAILABLE" });
    }
    return this.lf;
  }

  private mapExecutionFileError(e: unknown, code: string): never {
    if (!(e instanceof LangflowRequestError)) {
      throw e;
    }
    const lfBody = e.bodyText.length > 1200 ? `${e.bodyText.slice(0, 1200)}…` : e.bodyText;
    if (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 422) {
      throw new HttpException(e.status, e.message, {
        code,
        lf_body: lfBody,
        lf_status: e.status,
      });
    }
    throw new HttpException(502, e.message, {
      code,
      lf_body: lfBody,
      lf_status: e.status,
    });
  }

  private async requireBoundExecutionFlowId(ref: string): Promise<string> {
    const id = await this.crud.resolveFlowId(ref);
    const row = await this.repo.getFlow(id, this.crud.readProjectId());
    if (!row) {
      throw new NotFoundException(`Flow ${id} not found`);
    }
    const lfId = row.langflow_flow_id?.trim();
    if (!lfId) {
      throw new HttpException(400, "流程未绑定执行后端 flow，无法访问 flow 文件", {
        code: "EXECUTION_FLOW_UNBOUND",
      });
    }
    return lfId;
  }

  async listFlowFiles(flowRef: string): Promise<unknown> {
    const lf = this.requireClient();
    const executionFlowId = await this.requireBoundExecutionFlowId(flowRef);
    try {
      return await lf.listFlowFiles(executionFlowId);
    } catch (e) {
      return this.mapExecutionFileError(e, "FLOW_FILES_LIST");
    }
  }

  async uploadFlowFile(flowRef: string, file: File): Promise<unknown> {
    const lf = this.requireClient();
    const executionFlowId = await this.requireBoundExecutionFlowId(flowRef);
    try {
      return await lf.uploadFlowFile(executionFlowId, file);
    } catch (e) {
      return this.mapExecutionFileError(e, "FLOW_FILE_UPLOAD");
    }
  }

  async downloadFlowFile(flowRef: string, fileName: string): Promise<Response> {
    const lf = this.requireClient();
    const executionFlowId = await this.requireBoundExecutionFlowId(flowRef);
    try {
      return cloneDownloadResponse(await lf.downloadFlowFile(executionFlowId, fileName));
    } catch (e) {
      return this.mapExecutionFileError(e, "FLOW_FILE_DOWNLOAD");
    }
  }

  async downloadFlowImage(flowRef: string, fileName: string): Promise<Response> {
    const lf = this.requireClient();
    const executionFlowId = await this.requireBoundExecutionFlowId(flowRef);
    try {
      return cloneDownloadResponse(await lf.downloadFlowImage(executionFlowId, fileName));
    } catch (e) {
      return this.mapExecutionFileError(e, "FLOW_IMAGE_DOWNLOAD");
    }
  }

  async deleteFlowFile(flowRef: string, fileName: string): Promise<unknown> {
    const lf = this.requireClient();
    const executionFlowId = await this.requireBoundExecutionFlowId(flowRef);
    try {
      return await lf.deleteFlowFile(executionFlowId, fileName);
    } catch (e) {
      return this.mapExecutionFileError(e, "FLOW_FILE_DELETE");
    }
  }

  async listProfilePictures(): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.listProfilePictures();
    } catch (e) {
      return this.mapExecutionFileError(e, "PROFILE_PICTURES_LIST");
    }
  }

  async downloadProfilePicture(folderName: string, fileName: string): Promise<Response> {
    const lf = this.requireClient();
    try {
      return cloneDownloadResponse(await lf.downloadProfilePicture(folderName, fileName));
    } catch (e) {
      return this.mapExecutionFileError(e, "PROFILE_PICTURE_DOWNLOAD");
    }
  }

  async listUserFiles(): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.listUserFiles();
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILES_LIST");
    }
  }

  async uploadUserFile(file: File, append?: boolean): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.uploadUserFile(file, append);
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILE_UPLOAD");
    }
  }

  async downloadUserFile(fileId: string, options: FlowFileDownloadOptions = {}): Promise<Response> {
    const lf = this.requireClient();
    try {
      return cloneDownloadResponse(await lf.downloadUserFile(fileId, options.returnContent));
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILE_DOWNLOAD");
    }
  }

  async deleteUserFile(fileId: string): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.deleteUserFile(fileId);
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILE_DELETE");
    }
  }

  async deleteAllUserFiles(): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.deleteAllUserFiles();
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILES_DELETE_ALL");
    }
  }

  async deleteUserFilesBatch(fileIds: string[]): Promise<unknown> {
    const lf = this.requireClient();
    const ids = trimStringArray(fileIds);
    try {
      return await lf.deleteUserFilesBatch(ids);
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILES_DELETE_BATCH");
    }
  }

  async downloadUserFilesBatch(fileIds: string[]): Promise<Response> {
    const lf = this.requireClient();
    const ids = trimStringArray(fileIds);
    try {
      return cloneDownloadResponse(await lf.downloadUserFilesBatch(ids));
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILES_DOWNLOAD_BATCH");
    }
  }

  async renameUserFile(fileId: string, name: string): Promise<unknown> {
    const lf = this.requireClient();
    try {
      return await lf.renameUserFile(fileId, name);
    } catch (e) {
      return this.mapExecutionFileError(e, "USER_FILE_RENAME");
    }
  }
}
