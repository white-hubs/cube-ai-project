import { NotFoundException } from "@dangao/bun-server";
import { describe, expect, it, mock } from "bun:test";

import { DOCUMENT_UPLOAD_PORT_TOKEN, type DocumentUploadPort } from "../../../port/document-platform-sync.port";
import { type PlatformKbSourcePort } from "../../../port/platform-source.port";
import { DocumentPlatformSyncService } from "./document-platform-sync.service";

describe("DocumentPlatformSyncService", () => {
  it("no-ops when document already exists locally", async () => {
    const findById = mock(() => Promise.resolve({ id: "101" }));
    const documentRepository = { findById } as never;
    const platformKbSourcePort = {
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId: mock(() => Promise.resolve(null)),
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
      listSourceDocs: mock(() => Promise.resolve([])),
    } satisfies PlatformKbSourcePort;
    const uploadDocument = mock(() => Promise.resolve({ documentId: "101" }));
    const documentUploadPort = { uploadDocument } satisfies DocumentUploadPort;

    const service = new DocumentPlatformSyncService(documentRepository, platformKbSourcePort, documentUploadPort, {
      error: mock(() => undefined),
    } as never);
    await service.ensureDocumentAvailable("101", { directoryId: "dir-1", platformKbId: "999" });

    expect(findById).toHaveBeenCalledWith("101");
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("pulls from platform and uploads with stable document id when missing locally", async () => {
    const findById = mock(() => Promise.resolve(null));
    const documentRepository = { findById } as never;
    const getSourceDocByExternalId = mock(() =>
      Promise.resolve({
        bytes: new Uint8Array([1, 2, 3]),
        externalId: "2063877629778944002",
        fileName: "report.pdf",
        mimeType: "application/pdf",
      }),
    );
    const platformKbSourcePort = {
      getSourceDocByExternalId,
      getSourceDocByFileId: mock(() => Promise.resolve(null)),
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
      listSourceDocs: mock(() => Promise.resolve([])),
    } satisfies PlatformKbSourcePort;
    const uploadDocument = mock(() =>
      Promise.resolve({
        documentId: "2063877629778944002",
      }),
    );
    const documentUploadPort = { uploadDocument } satisfies DocumentUploadPort;

    const service = new DocumentPlatformSyncService(documentRepository, platformKbSourcePort, documentUploadPort, {
      error: mock(() => undefined),
    } as never);
    await service.ensureDocumentAvailable("2063877629778944002", {
      directoryId: "dir-abc",
      platformKbId: "888",
    });

    expect(getSourceDocByExternalId).toHaveBeenCalledWith("888", "2063877629778944002");
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const uploadArgs = uploadDocument.mock.calls[0] as unknown[];
    expect(uploadArgs[1]).toBe("dir-abc");
    expect(uploadArgs[3]).toBe("2063877629778944002");
  });

  it("falls back to file id lookup when kb lookup misses", async () => {
    const documentRepository = { findById: mock(() => Promise.resolve(null)) } as never;
    const getSourceDocByFileId = mock(() =>
      Promise.resolve({
        bytes: new Uint8Array([9]),
        externalId: "42",
        fileName: "note.txt",
        mimeType: "text/plain",
      }),
    );
    const platformKbSourcePort = {
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId,
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
      listSourceDocs: mock(() => Promise.resolve([])),
    } satisfies PlatformKbSourcePort;
    const uploadDocument = mock(() => Promise.resolve({ documentId: "42" }));
    const documentUploadPort = { uploadDocument } satisfies DocumentUploadPort;

    const service = new DocumentPlatformSyncService(documentRepository, platformKbSourcePort, documentUploadPort, {
      error: mock(() => undefined),
    } as never);
    await service.ensureDocumentAvailable("42");

    expect(getSourceDocByFileId).toHaveBeenCalledWith("42");
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect((uploadDocument.mock.calls[0] as unknown[])[1]).toBe("42");
  });

  it("falls back to knowledge base id lookup before file id lookup", async () => {
    const documentRepository = { findById: mock(() => Promise.resolve(null)) } as never;
    const getSourceDocByKnowledgeBaseId = mock(() =>
      Promise.resolve({
        bytes: new Uint8Array([7]),
        externalId: "999-file",
        fileName: "kb-doc.pdf",
        mimeType: "application/pdf",
      }),
    );
    const getSourceDocByFileId = mock(() => Promise.resolve(null));
    const platformKbSourcePort = {
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId,
      getSourceDocByKnowledgeBaseId,
      listSourceDocs: mock(() => Promise.resolve([])),
    } satisfies PlatformKbSourcePort;
    const uploadDocument = mock(() => Promise.resolve({ documentId: "2063877629778944002" }));
    const documentUploadPort = { uploadDocument } satisfies DocumentUploadPort;

    const service = new DocumentPlatformSyncService(documentRepository, platformKbSourcePort, documentUploadPort, {
      error: mock(() => undefined),
    } as never);
    await service.ensureDocumentAvailable("2063877629778944002");

    expect(getSourceDocByKnowledgeBaseId).toHaveBeenCalledWith("2063877629778944002");
    expect(getSourceDocByFileId).not.toHaveBeenCalled();
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it("throws NotFoundException when platform has no matching source doc", async () => {
    const documentRepository = { findById: mock(() => Promise.resolve(null)) } as never;
    const platformKbSourcePort = {
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId: mock(() => Promise.resolve(null)),
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
      listSourceDocs: mock(() => Promise.resolve([])),
    } satisfies PlatformKbSourcePort;
    const documentUploadPort = {
      uploadDocument: mock(() => Promise.resolve({ documentId: "x" })),
    } satisfies DocumentUploadPort;

    const service = new DocumentPlatformSyncService(documentRepository, platformKbSourcePort, documentUploadPort, {
      error: mock(() => undefined),
    } as never);
    await expect(service.ensureDocumentAvailable("missing-id")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("exports distinct upload port token", () => {
    expect(DOCUMENT_UPLOAD_PORT_TOKEN).not.toBe(undefined);
  });
});
