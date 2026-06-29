import { createHmac, timingSafeEqual } from "node:crypto";

/** 期望头：`x-cube-signature: sha256=<hex>` */
export function verifyWebhookHmac(bodyRaw: string, sigHeader: string | null, secret: string): boolean {
  if (!sigHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(bodyRaw, "utf8").digest("hex");
  const got = sigHeader.slice("sha256=".length).trim();
  if (!/^[0-9a-f]+$/iu.test(got) || got.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
  } catch {
    return false;
  }
}
