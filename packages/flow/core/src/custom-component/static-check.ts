/** 极简括号平衡检查（不保证 Python 语法正确）。 */
export function roughPythonBraceBalance(python: string): { ok: boolean; detail?: string } {
  let depth = 0;
  let bracket = 0;
  let inSingle = false;
  let inDouble = false;
  let triSingle = 0;
  let triDouble = 0;
  for (let i = 0; i < python.length; i++) {
    const c = python[i]!;
    if (triSingle > 0 || triDouble > 0) {
      if (triSingle && python.slice(i, i + 3) === "'''") {
        triSingle--;
        i += 2;
        continue;
      }
      if (triDouble && python.slice(i, i + 3) === '"""') {
        triDouble--;
        i += 2;
        continue;
      }
      continue;
    }
    if (!inDouble && c === "'" && python.slice(i, i + 3) === "'''") {
      triSingle++;
      i += 2;
      continue;
    }
    if (!inSingle && c === '"' && python.slice(i, i + 3) === '"""') {
      triDouble++;
      i += 2;
      continue;
    }
    if (!inDouble && c === "'" && !inSingle) {
      inSingle = true;
    } else if (!inDouble && c === "'" && inSingle) {
      inSingle = false;
    } else if (!inSingle && c === '"' && !inDouble) {
      inDouble = true;
    } else if (!inSingle && c === '"' && inDouble) {
      inDouble = false;
    } else if (inSingle || inDouble) {
      continue;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth < 0) {
        return { ok: false, detail: "unbalanced )" };
      }
    } else if (c === "[") {
      bracket++;
    } else if (c === "]") {
      bracket--;
      if (bracket < 0) {
        return { ok: false, detail: "unbalanced ]" };
      }
    }
  }
  if (depth !== 0) {
    return { ok: false, detail: "unbalanced ()" };
  }
  if (bracket !== 0) {
    return { ok: false, detail: "unbalanced []" };
  }
  if (inSingle || inDouble) {
    return { ok: false, detail: "unclosed quote" };
  }
  return { ok: true };
}
