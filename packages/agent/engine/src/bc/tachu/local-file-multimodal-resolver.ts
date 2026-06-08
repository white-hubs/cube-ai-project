import type {
  AdapterCallContext,
  MultimodalResolver,
  ResourceReference,
  ResourceResolveEntry,
} from '@tachu/core';
import pino from 'pino';
import type { ImageAssetReader } from '../files/image-asset-reader';

const log = pino({
  name: 'agentic.engine.multimodal',
  level: (process.env['AGENTIC_ENGINE_LOG_LEVEL'] ?? 'info').toLowerCase(),
});

const DEGRADE_ZH =
  '无法读取您上传的图片，请确认文件仍存在且您有权限访问，或重新上传后再试。';

const failure = (reason: string): Extract<ResourceResolveEntry, { ok: false }> => ({
  ok: false,
  reason,
  userVisibleReason: DEGRADE_ZH,
});

const resolveImage = async (
  ref: ResourceReference,
  reader: ImageAssetReader,
  ctx: AdapterCallContext,
): Promise<ResourceResolveEntry> => {
  const tenant = ctx.tenant;
  if (tenant === undefined) {
    return failure('tenant required for image resolution');
  }
  const fileId = ref.uri.trim();
  if (!fileId) {
    return failure('empty resource uri');
  }
  const image = await reader.readImageAsset({
    tenant,
    fileId,
    ...(ctx.subject?.userId ? { userId: ctx.subject.userId } : {}),
  });
  log.info(
    { key: ref.key, fileId, mimeType: image.mimeType, sizeBytes: image.bytes.byteLength, tenant },
    'multimodal.image_resolved',
  );
  return {
    ok: true,
    part: {
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`,
      },
    },
  };
};

export class LocalFileMultimodalResolver implements MultimodalResolver {
  constructor(private readonly reader: ImageAssetReader) {}

  async resolveResources(
    refs: readonly ResourceReference[],
    ctx: AdapterCallContext,
  ): Promise<Map<string, ResourceResolveEntry>> {
    log.debug(
      {
        refCount: refs.length,
        kinds: refs.map((r) => r.kind),
        keys: refs.map((r) => r.key),
        tenant: ctx.tenant,
        hasUserId: Boolean(ctx.subject?.userId),
      },
      'multimodal.resolve_resources.start',
    );
    const out = new Map<string, ResourceResolveEntry>();
    for (const ref of refs) {
      if (ref.kind !== 'image') {
        out.set(ref.key, failure(`unsupported resource kind "${ref.kind}"`));
        continue;
      }
      try {
        out.set(ref.key, await resolveImage(ref, this.reader, ctx));
      } catch (err) {
        log.warn(
          { key: ref.key, uri: ref.uri, err: err instanceof Error ? err.message : String(err) },
          'multimodal.image_resolve_failed',
        );
        out.set(ref.key, failure('image-resolution-failed'));
      }
    }
    return out;
  }
}
