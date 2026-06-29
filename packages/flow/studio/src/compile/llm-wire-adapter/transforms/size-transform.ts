import type { ChannelProfile } from "../wire-context.types";

export function resolveWireSize(
  canonical: { size?: string; sizeTier?: string },
  profile: { nativeFamily: string | null; channelProfile: ChannelProfile },
): string {
  const raw = canonical.size?.trim();
  if (profile.nativeFamily === "seedream" && profile.channelProfile === "aggregator_native") {
    const seedreamAggregator: Record<string, string> = {
      "1024*1024": "2K",
      "1024*1792": "2K",
      "1024x1024": "2K",
      "1024x1792": "2K",
      "1792*1024": "2K",
      "1792x1024": "2K",
      "1k": "1K",
      "2k": "2K",
      "4k": "4K",
    };
    return seedreamAggregator[raw?.toLowerCase() ?? ""] ?? raw ?? "2K";
  }
  if (profile.nativeFamily === "seedream" && profile.channelProfile === "direct") {
    const seedreamDirect: Record<string, string> = {
      "1024*1024": "2k",
      "1024*1792": "2k",
      "1024x1024": "2k",
      "1024x1792": "2k",
      "1792*1024": "2k",
      "1792x1024": "2k",
      "2048*2048": "2k",
      "2048x2048": "2k",
      "2k": "2k",
      "3072*3072": "3k",
      "3072x3072": "3k",
      "3k": "3k",
      "4096*4096": "4k",
      "4096x4096": "4k",
      "4k": "4k",
      "5120*5120": "5k",
      "5120x5120": "5k",
      "5k": "5k",
    };
    return seedreamDirect[raw?.toLowerCase() ?? ""] ?? raw?.toLowerCase() ?? "2k";
  }
  return (raw || "1024x1024").replace("*", "x");
}
