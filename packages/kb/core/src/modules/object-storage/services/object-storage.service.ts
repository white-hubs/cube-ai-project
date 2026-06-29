import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Inject, Injectable } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";

export interface PutObjectParams {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  /** 原始文件名，仅作元数据用途 */
  fileName: string;
}

export interface PutObjectResult {
  storageBucket: string;
  storageKey: string;
}

export interface GetObjectParams {
  bucket: string;
  objectKey: string;
}

export interface DeleteObjectParams {
  bucket: string;
  objectKey: string;
}

@Injectable()
export class ObjectStorageService {
  private s3Client: S3Client | null = null;
  private s3ConfigSignature: string | null = null;

  public constructor(@Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig) {}

  private getS3Client(): S3Client {
    const c = this.config;
    const signature = `${c.minioEndpoint}|${c.minioAccessKey}|${c.minioRegion}|${c.minioUsePathStyle}`;
    if (this.s3Client && this.s3ConfigSignature === signature) {
      return this.s3Client;
    }
    if (!c.minioEndpoint.trim()) {
      throw new Error("MinIO 未配置：请在 app.json 或环境变量中设置 minioEndpoint（或 MINIO_ENDPOINT）");
    }
    if (!c.minioAccessKey || !c.minioSecretKey) {
      throw new Error("MinIO 未配置：请设置 minioAccessKey / minioSecretKey（或 MINIO_ACCESS_KEY / MINIO_SECRET_KEY）");
    }
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: c.minioAccessKey,
        secretAccessKey: c.minioSecretKey,
      },
      endpoint: c.minioEndpoint,
      forcePathStyle: c.minioUsePathStyle,
      region: c.minioRegion,
    });
    this.s3ConfigSignature = signature;
    return this.s3Client;
  }

  private resolveKbBucket(): string {
    const bucket = this.config.minioKbBucket.trim();
    if (!bucket) {
      throw new Error("MinIO 未配置：请设置 minioKbBucket（或 MINIO_KB_BUCKET）");
    }
    return bucket;
  }

  /**
   * 上传对象至 MinIO（S3 兼容 API）。
   */
  public async putObject(params: PutObjectParams): Promise<PutObjectResult> {
    const bucket = this.resolveKbBucket();
    const client = this.getS3Client();
    await client.send(
      new PutObjectCommand({
        Body: params.body,
        Bucket: bucket,
        ContentType: params.contentType || "application/octet-stream",
        Key: params.objectKey,
      }),
    );
    return {
      storageBucket: bucket,
      storageKey: params.objectKey,
    };
  }

  public async getObject(params: GetObjectParams): Promise<Uint8Array> {
    const client = this.getS3Client();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.objectKey,
      }),
    );
    const body = out.Body;
    if (!body) {
      throw new Error("MinIO GetObject 响应体为空");
    }
    return new Uint8Array(await body.transformToByteArray());
  }

  /** 删除对象（S3 DeleteObject 在键不存在时仍返回成功，天然幂等）。 */
  public async deleteObject(params: DeleteObjectParams): Promise<void> {
    const client = this.getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: params.bucket,
        Key: params.objectKey,
      }),
    );
  }
}
