import { Injectable } from "@dangao/bun-server";

import type { ParsedDocumentChunk } from "../../common/document-types";

export interface PropertyEntry {
  key: string;
  value: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

function inferNamespace(key: string): string {
  if (key.includes(".")) {
    return key.split(".")[0] ?? "default";
  }
  if (key.includes("_")) {
    return key.split("_")[0] ?? "default";
  }
  return "default";
}

@Injectable()
export class PropertiesGroupChunker {
  public chunk(filename: string, entries: PropertyEntry[]): ParsedDocumentChunk[] {
    const grouped = new Map<string, PropertyEntry[]>();
    for (const entry of entries) {
      const namespace = inferNamespace(entry.key);
      const bucket = grouped.get(namespace) ?? [];
      bucket.push(entry);
      grouped.set(namespace, bucket);
    }

    return Array.from(grouped.entries()).map(([propertyNamespace, group], index) => {
      const displayText = group.map((entry) => `${entry.key}=${entry.value}`).join("\n");
      return {
        captionText: null,
        chunkIndex: index,
        chunkType: "properties-group",
        displayText,
        embeddingText: [`文件: ${filename}`, `命名空间: ${propertyNamespace}`, ...group.map((entry) => `${entry.key}=${entry.value}`)].join(
          "\n",
        ),
        headingPath: [propertyNamespace],
        keywords: group.flatMap((entry) => [entry.key, entry.value]).filter((value) => value.trim() !== ""),
        orderInSection: index,
        pageNo: null,
        pictureDescription: null,
        propertyNamespace,
        sectionId: `properties:${slugify(propertyNamespace) || "default"}`,
      };
    });
  }
}
