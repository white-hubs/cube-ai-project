import type { CubeCustomStep } from "./dsl-shared";

export interface OperatorStep {
  action: CubeCustomStep["action"] | "message_merge" | "message_to_openai_content";
  params: Record<string, unknown>;
}

export interface OperatorEmit {
  lines: string[];
  imports: string[];
  pip?: { name: string; version?: string }[];
}

/** inputNames 为 undefined 时占位符一律展开为 self.name（v1 行为）。 */
export function expandPlaceholders(expr: string, inputNames?: Set<string>): string {
  return expr.replaceAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gu, (_m, name: string) => {
    if (/^_s\d+$/u.test(name)) {
      return name;
    }
    if (inputNames === undefined) {
      return `self.${name}`;
    }
    if (inputNames.has(name)) {
      return `self.${name}`;
    }
    return name;
  });
}

/**
 * 算子级 pip 依赖（LF metadata / 环境由联调决定是否消费）。
 */
export const OPERATOR_PIP: Record<OperatorStep["action"], { name: string; version?: string }[] | undefined> = {
  assign: undefined,
  http_request: [{ name: "requests" }],
  json_parse: undefined,
  message_merge: undefined,
  message_to_openai_content: [{ name: "requests" }],
  template_render: undefined,
};

function timeoutSecondsFromMs(raw: unknown, fallbackMs = 30000): string {
  const timeoutMs = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : fallbackMs;
  return String(timeoutMs / 1000);
}

export function emitOperatorStep(step: OperatorStep, targetVar: string, inputNames?: Set<string>): OperatorEmit {
  const varName = targetVar;
  const action = step.action;
  const p = step.params;

  if (action === "assign") {
    const expr =
      typeof p["expr"] === "string" ? expandPlaceholders(p["expr"], inputNames) : expandPlaceholders(String(p["expr"] ?? ""), inputNames);
    return { imports: [], lines: [`${varName} = ${expr}`] };
  }

  if (action === "http_request") {
    const method = typeof p["method"] === "string" ? p["method"].toUpperCase() : "GET";
    const urlRaw = typeof p["url"] === "string" ? p["url"] : "";
    const urlPy = expandPlaceholders(urlRaw, inputNames);
    const timeoutSeconds = timeoutSecondsFromMs(p["timeout_ms"]);
    const body =
      p["body"] !== null && p["body"] !== undefined && typeof p["body"] === "string" && p["body"].length > 0
        ? expandPlaceholders(p["body"], inputNames)
        : undefined;
    const lines: string[] = [];
    if (method === "POST" && body !== undefined) {
      lines.push(`${varName} = requests.request("${method}", ${urlPy}, data=${body}, timeout=${timeoutSeconds}).text`);
    } else {
      lines.push(`${varName} = requests.request("${method}", ${urlPy}, timeout=${timeoutSeconds}).text`);
    }
    return { imports: ["import requests"], lines, pip: OPERATOR_PIP.http_request };
  }

  if (action === "json_parse") {
    const src =
      typeof p["from"] === "string"
        ? expandPlaceholders(p["from"], inputNames)
        : expandPlaceholders(String(p["from"] ?? "_s0"), inputNames);
    return { imports: ["import json"], lines: [`${varName} = json.loads(${src})`] };
  }

  if (action === "template_render") {
    const tpl = typeof p["template"] === "string" ? p["template"] : "";
    const mapping = p["mapping"];
    const lines: string[] = [];
    if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) {
        const rhs = typeof v === "string" ? expandPlaceholders(v, inputNames) : JSON.stringify(v);
        parts.push(`${JSON.stringify(k)}: str(${rhs})`);
      }
      const dictLit = `{${parts.join(", ")}}`;
      lines.push(`${varName} = ${JSON.stringify(tpl)}.format(**${dictLit})`);
    } else {
      lines.push(`${varName} = ${JSON.stringify(tpl)}`);
    }
    return { imports: [], lines };
  }

  if (action === "message_merge") {
    const textExpr =
      typeof p["text"] === "string" ? expandPlaceholders(p["text"], inputNames) : expandPlaceholders(String(p["text"] ?? ""), inputNames);
    const messageExpr =
      typeof p["message"] === "string"
        ? expandPlaceholders(p["message"], inputNames)
        : expandPlaceholders(String(p["message"] ?? "None"), inputNames);
    const textSrcVar = `_${varName}_text_source`;
    const textVar = `_${varName}_text`;
    const textDataVar = `_${varName}_text_data`;
    const srcVar = `_${varName}_source`;
    const srcDataVar = `_${varName}_source_data`;
    const originalTextVar = `_${varName}_original_text`;
    const filesVar = `_${varName}_files`;
    return {
      imports: ["from lfx.schema.message import Message"],
      lines: [
        `${textSrcVar} = ${textExpr}`,
        `${textVar} = getattr(${textSrcVar}, "text", None)`,
        `if not ${textVar} and isinstance(${textSrcVar}, dict):`,
        `    ${textVar} = ${textSrcVar}.get("text") or ${textSrcVar}.get("content") or ${textSrcVar}.get("message")`,
        `${textDataVar} = getattr(${textSrcVar}, "data", None)`,
        `if not ${textVar} and isinstance(${textDataVar}, dict):`,
        `    ${textVar} = ${textDataVar}.get("text") or ${textDataVar}.get("content") or ${textDataVar}.get("message")`,
        `if ${textVar} is None:`,
        `    ${textVar} = ${textSrcVar}`,
        `${srcVar} = ${messageExpr}`,
        `${srcDataVar} = getattr(${srcVar}, "data", None)`,
        `${originalTextVar} = getattr(${srcVar}, "text", None)`,
        `if not ${originalTextVar} and isinstance(${srcVar}, dict):`,
        `    ${originalTextVar} = ${srcVar}.get("text") or ${srcVar}.get("content") or ${srcVar}.get("message")`,
        `if not ${originalTextVar} and isinstance(${srcDataVar}, dict):`,
        `    ${originalTextVar} = ${srcDataVar}.get("text") or ${srcDataVar}.get("content") or ${srcDataVar}.get("message")`,
        `if not ${textVar} and ${originalTextVar}:`,
        `    ${textVar} = ${originalTextVar}`,
        `${varName} = Message(text=str(${textVar}) if ${textVar} is not None else "", sender="Machine", sender_name="AI")`,
        `${filesVar} = getattr(${srcVar}, "files", None)`,
        `if ${filesVar} is None and isinstance(${srcVar}, dict):`,
        `    ${filesVar} = ${srcVar}.get("files")`,
        `if ${filesVar} is None and isinstance(${srcDataVar}, dict):`,
        `    ${filesVar} = ${srcDataVar}.get("files")`,
        `if ${filesVar} is not None:`,
        `    ${varName}.files = ${filesVar}`,
      ],
    };
  }

  if (action === "message_to_openai_content") {
    const messageExpr =
      typeof p["message"] === "string"
        ? expandPlaceholders(p["message"], inputNames)
        : expandPlaceholders(String(p["message"] ?? "None"), inputNames);
    const maxFileBytes =
      typeof p["max_file_bytes"] === "number" && Number.isFinite(p["max_file_bytes"]) && p["max_file_bytes"] > 0
        ? Math.floor(p["max_file_bytes"])
        : 20 * 1024 * 1024;
    const srcVar = `_${varName}_message`;
    const srcDataVar = `_${varName}_message_data`;
    const textVar = `_${varName}_text`;
    const filesVar = `_${varName}_files`;
    const maxBytesVar = `_${varName}_max_file_bytes`;
    const fileVar = `_${varName}_file`;
    const rawUrlVar = `_${varName}_raw_url`;
    const rawCandidatesVar = `_${varName}_raw_candidates`;
    const rawCandidateVar = `_${varName}_raw_candidate`;
    const fetchUrlVar = `_${varName}_fetch_url`;
    const baseUrlVar = `_${varName}_base_url`;
    const mimeVar = `_${varName}_mime`;
    const guessedMimeVar = `_${varName}_guessed_mime`;
    const dataHeaderVar = `_${varName}_data_header`;
    const dataPayloadVar = `_${varName}_data_payload`;
    const responseVar = `_${varName}_response`;
    const bytesVar = `_${varName}_bytes`;
    const readBytesVar = `_${varName}_read_file_bytes`;
    const resolvedPathVar = `_${varName}_resolved_path`;
    const localCandidatesVar = `_${varName}_local_candidates`;
    const localCandidateVar = `_${varName}_local_candidate`;
    const urlVar = `_${varName}_url`;
    const fileDataVar = `_${varName}_file_data`;
    const imageCountVar = `_${varName}_image_count`;
    const errorsVar = `_${varName}_file_errors`;
    const lastErrorVar = `_${varName}_last_error`;
    return {
      imports: [
        "import base64",
        "import mimetypes",
        "import os",
        "import requests",
        "import urllib.parse",
        "from lfx.base.data.storage_utils import parse_storage_path, read_file_bytes",
        "from lfx.utils.async_helpers import run_until_complete",
      ],
      lines: [
        `${maxBytesVar} = ${maxFileBytes}`,
        `def ${readBytesVar}(_path_value):`,
        `    _path = str(_path_value or "")`,
        `    if not _path:`,
        `        return None, ""`,
        `    if _path.startswith("file://"):`,
        `        _path = _path[7:]`,
        `    ${localCandidatesVar} = [_path]`,
        `    if parse_storage_path(_path):`,
        `        try:`,
        `            _full_path = getattr(self, "get_full_path")(_path)`,
        `            if _full_path:`,
        `                ${localCandidatesVar}.append(str(_full_path))`,
        `        except Exception:`,
        `            pass`,
        `    try:`,
        `        ${resolvedPathVar} = self.resolve_path(_path)`,
        `        if ${resolvedPathVar}:`,
        `            ${localCandidatesVar}.append(str(${resolvedPathVar}))`,
        `    except Exception:`,
        `        pass`,
        `    for ${localCandidateVar} in ${localCandidatesVar}:`,
        `        if ${localCandidateVar} and os.path.exists(str(${localCandidateVar})):`,
        `            with open(str(${localCandidateVar}), "rb") as _fh:`,
        `                return _fh.read(), str(${localCandidateVar})`,
        `    try:`,
        `        return run_until_complete(read_file_bytes(_path)), _path`,
        `    except Exception:`,
        `        return None, _path`,
        `${srcVar} = ${messageExpr}`,
        `${srcDataVar} = getattr(${srcVar}, "data", None)`,
        `${textVar} = getattr(${srcVar}, "text", None)`,
        `if not ${textVar} and isinstance(${srcVar}, dict):`,
        `    ${textVar} = ${srcVar}.get("text") or ${srcVar}.get("content") or ${srcVar}.get("message")`,
        `if not ${textVar} and isinstance(${srcDataVar}, dict):`,
        `    ${textVar} = ${srcDataVar}.get("text") or ${srcDataVar}.get("content") or ${srcDataVar}.get("message")`,
        `if ${textVar} is None:`,
        `    ${textVar} = ${srcVar}`,
        `${filesVar} = getattr(${srcVar}, "files", None)`,
        `if ${filesVar} is None and isinstance(${srcVar}, dict):`,
        `    ${filesVar} = ${srcVar}.get("files")`,
        `if ${filesVar} is None and isinstance(${srcDataVar}, dict):`,
        `    ${filesVar} = ${srcDataVar}.get("files")`,
        `if ${filesVar}:`,
        `    ${varName} = [{"type": "text", "text": str(${textVar} or "")}]`,
        `    ${imageCountVar} = 0`,
        `    ${errorsVar} = []`,
        `    for ${fileVar} in (${filesVar} if isinstance(${filesVar}, list) else [${filesVar}]):`,
        `        ${rawCandidatesVar} = []`,
        `        ${mimeVar} = None`,
        `        if isinstance(${fileVar}, str):`,
        `            ${rawCandidatesVar}.append(${fileVar})`,
        `        elif isinstance(${fileVar}, dict):`,
        `            ${rawCandidatesVar}.extend([${fileVar}.get("path"), ${fileVar}.get("file_path"), ${fileVar}.get("url"), ${fileVar}.get("name")])`,
        `            ${fileDataVar} = ${fileVar}.get("data")`,
        `            if isinstance(${fileDataVar}, dict):`,
        `                ${rawCandidatesVar}.extend([${fileDataVar}.get("path"), ${fileDataVar}.get("file_path"), ${fileDataVar}.get("url"), ${fileDataVar}.get("name")])`,
        `            ${mimeVar} = ${fileVar}.get("mime_type") or ${fileVar}.get("mime") or ${fileVar}.get("content_type")`,
        `            if not ${mimeVar} and isinstance(${fileDataVar}, dict):`,
        `                ${mimeVar} = ${fileDataVar}.get("mime_type") or ${fileDataVar}.get("mime") or ${fileDataVar}.get("content_type")`,
        `        else:`,
        `            ${rawCandidatesVar}.extend([getattr(${fileVar}, "path", None), getattr(${fileVar}, "file_path", None), getattr(${fileVar}, "url", None), getattr(${fileVar}, "name", None)])`,
        `            ${fileDataVar} = getattr(${fileVar}, "data", None)`,
        `            if isinstance(${fileDataVar}, dict):`,
        `                ${rawCandidatesVar}.extend([${fileDataVar}.get("path"), ${fileDataVar}.get("file_path"), ${fileDataVar}.get("url"), ${fileDataVar}.get("name")])`,
        `            ${mimeVar} = getattr(${fileVar}, "mime_type", None) or getattr(${fileVar}, "mime", None) or getattr(${fileVar}, "content_type", None)`,
        `            if not ${mimeVar} and isinstance(${fileDataVar}, dict):`,
        `                ${mimeVar} = ${fileDataVar}.get("mime_type") or ${fileDataVar}.get("mime") or ${fileDataVar}.get("content_type")`,
        `        ${rawCandidatesVar} = [str(_candidate) for _candidate in ${rawCandidatesVar} if _candidate]`,
        `        if not ${rawCandidatesVar}:`,
        `            ${errorsVar}.append("missing file path/url in Message.files item")`,
        `            continue`,
        `        ${urlVar} = None`,
        `        ${lastErrorVar} = ""`,
        `        for ${rawCandidateVar} in ${rawCandidatesVar}:`,
        `            ${rawUrlVar} = str(${rawCandidateVar})`,
        `            try:`,
        `                if ${rawUrlVar}.startswith("data:"):`,
        `                    if not ${rawUrlVar}.lower().startswith("data:image/"):`,
        `                        ${lastErrorVar} = "unsupported non-image data URL"`,
        `                        continue`,
        `                    ${dataHeaderVar}, ${dataPayloadVar} = ${rawUrlVar}.split(",", 1) if "," in ${rawUrlVar} else (${rawUrlVar}, "")`,
        `                    ${mimeVar} = ${mimeVar} or (${dataHeaderVar}[5:].split(";", 1)[0] if len(${dataHeaderVar}) > 5 else "") or "image/png"`,
        `                    if not str(${mimeVar}).lower().startswith("image/"):`,
        `                        ${lastErrorVar} = "unsupported MIME type " + str(${mimeVar})`,
        `                        continue`,
        `                    if ";base64" in ${dataHeaderVar}.lower():`,
        `                        ${urlVar} = "data:" + str(${mimeVar}) + ";base64," + ${dataPayloadVar}`,
        `                    else:`,
        `                        ${bytesVar} = urllib.parse.unquote_to_bytes(${dataPayloadVar})`,
        `                        if len(${bytesVar}) > ${maxBytesVar}:`,
        `                            ${lastErrorVar} = "image file exceeds max_file_bytes"`,
        `                            continue`,
        `                        ${urlVar} = "data:" + str(${mimeVar}) + ";base64," + base64.b64encode(${bytesVar}).decode("ascii")`,
        `                    break`,
        `                ${guessedMimeVar} = mimetypes.guess_type(${rawUrlVar}.split("?", 1)[0])[0]`,
        `                if ${rawUrlVar}.startswith("/") or ${rawUrlVar}.startswith(("http://", "https://")):`,
        `                    ${fetchUrlVar} = ${rawUrlVar}`,
        `                    if ${fetchUrlVar}.startswith("/"):`,
        `                        ${baseUrlVar} = (os.environ.get("LANGFLOW_BASE_URL") or os.environ.get("LANGFLOW_URL") or "http://127.0.0.1:7860").rstrip("/")`,
        `                        ${fetchUrlVar} = ${baseUrlVar} + ${fetchUrlVar}`,
        `                    ${responseVar} = requests.get(${fetchUrlVar}, timeout=30)`,
        `                    ${responseVar}.raise_for_status()`,
        `                    ${mimeVar} = ${mimeVar} or (${responseVar}.headers.get("content-type", "").split(";", 1)[0] if ${responseVar}.headers else "") or ${guessedMimeVar} or "image/png"`,
        `                    ${bytesVar} = ${responseVar}.content`,
        `                else:`,
        `                    ${bytesVar}, ${resolvedPathVar} = ${readBytesVar}(${rawUrlVar})`,
        `                    if ${bytesVar} is None:`,
        `                        ${lastErrorVar} = "unable to read Langflow file path " + ${rawUrlVar}`,
        `                        continue`,
        `                    ${mimeVar} = ${mimeVar} or mimetypes.guess_type(str(${resolvedPathVar} or ${rawUrlVar}))[0] or ${guessedMimeVar} or "image/png"`,
        `                if len(${bytesVar}) > ${maxBytesVar}:`,
        `                    ${lastErrorVar} = "image file exceeds max_file_bytes"`,
        `                    continue`,
        `                if not str(${mimeVar}).lower().startswith("image/"):`,
        `                    ${lastErrorVar} = "unsupported MIME type " + str(${mimeVar})`,
        `                    continue`,
        `                ${urlVar} = "data:" + str(${mimeVar}) + ";base64," + base64.b64encode(${bytesVar}).decode("ascii")`,
        `                break`,
        `            except Exception as _e:`,
        `                ${lastErrorVar} = str(_e)`,
        `                continue`,
        `        if not ${urlVar}:`,
        `            ${errorsVar}.append(${lastErrorVar} or ("unable to read image from " + ", ".join(${rawCandidatesVar}[:3])))`,
        `            continue`,
        `        ${varName}.append({"type": "image_url", "image_url": {"url": str(${urlVar})}})`,
        `        ${imageCountVar} += 1`,
        `    if ${imageCountVar} == 0:`,
        `        raise RuntimeError("Message.files was provided but no image bytes could be read. " + "; ".join(${errorsVar}[:3]))`,
        `else:`,
        `    ${varName} = str(${textVar} or "")`,
      ],
      pip: OPERATOR_PIP.message_to_openai_content,
    };
  }

  return { imports: [], lines: [`${varName} = None`] };
}

export function collectPipFromSteps(steps: OperatorStep[]): { name: string; version?: string }[] {
  const seen = new Set<string>();
  const out: { name: string; version?: string }[] = [];
  for (const s of steps) {
    const list = OPERATOR_PIP[s.action];
    if (!list) {
      continue;
    }
    for (const d of list) {
      if (seen.has(d.name)) {
        continue;
      }
      seen.add(d.name);
      out.push(d);
    }
  }
  return out;
}
