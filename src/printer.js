const STRUCTURAL_KEYWORDS = new Set([
  "by",
  "constraint",
  "foreign",
  "key",
  "partition",
  "primary",
  "range",
  "references",
  "unique"
]);

export function printSql(ast) {
  const body = ast.statements.map(printStatement).join("\n\n");
  return body ? `${body}\n` : "";
}

function printStatement(statement) {
  switch (statement.type) {
    case "create_domain":
      return `CREATE DOMAIN ${statement.name} AS ${statement.dataType};`;
    case "create_type_enum":
      return [
        `CREATE TYPE ${statement.name} AS ENUM (`,
        ...statement.items.map((item, index) =>
          `  ${item}${index === statement.items.length - 1 ? "" : ","}`
        ),
        ");"
      ].join("\n");
    case "create_table":
      return printCreateTable(statement);
    default:
      return normalizeUnsupported(statement.raw);
  }
}

function printCreateTable(statement) {
  const columns = statement.entries.filter((entry) => entry.type === "column");
  const nameWidth = Math.max(...columns.map((entry) => entry.name.length), 0);
  const typeWidth = Math.max(...columns.map((entry) => entry.dataType.length), 0);
  const nullWidth = Math.max(...columns.map((entry) => entry.nullability.length), 0);
  const entryLines = [];

  statement.entries.forEach((entry, index) => {
    const isLast = index === statement.entries.length - 1;

    if (entry.type === "comment_only") {
      entryLines.push(...entry.comments);
      return;
    }

    if (entry.comments.length > 0) {
      entryLines.push(...entry.comments);
    }

    let content;

    if (entry.type === "column") {
      content = formatColumn(entry, { nameWidth, typeWidth, nullWidth });
    } else {
      content = formatStructuralSql(entry.content);
    }

    entryLines.push(`${content}${isLast ? "" : ","}`);
  });

  const preserved = preserveCanonicalTable(statement, entryLines);

  if (preserved) {
    return preserved;
  }

  const lines = [`CREATE TABLE ${statement.ifNotExists ? "IF NOT EXISTS " : ""}${statement.name} (`];
  lines.push(...entryLines.map((line) => `  ${line}`));

  let closing = ")";

  if (statement.suffix) {
    closing += ` ${formatStructuralSql(statement.suffix)}`;
  }

  lines.push(`${closing};`);
  return lines.join("\n");
}

function formatColumn(entry, widths) {
  const base = `${entry.name.padEnd(widths.nameWidth)} ${entry.dataType.padEnd(widths.typeWidth)}`;

  if (!entry.nullability) {
    return entry.extras ? `${base} ${entry.extras}` : base;
  }

  const nullability = entry.nullability.padStart(widths.nullWidth);
  const suffix = entry.extras ? ` ${entry.extras}` : "";
  return `${base} ${nullability}${suffix}`;
}

function formatStructuralSql(source) {
  let result = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const flushToken = () => {
    if (!token) {
      return;
    }

    const lowerToken = token.toLowerCase();
    result += STRUCTURAL_KEYWORDS.has(lowerToken) ? lowerToken.toUpperCase() : token;
    token = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (!inDoubleQuote && char === "'" && source[index - 1] !== "\\") {
      flushToken();
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      flushToken();
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      result += char;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      token += char;
      continue;
    }

    flushToken();
    result += char;
  }

  flushToken();
  return result.replace(/([A-Za-z_"][A-Za-z0-9_"]*)\(/g, "$1 (");
}

function normalizeUnsupported(source) {
  return source.trim().replace(/\s+\n/g, "\n").trimEnd() + ";";
}

function preserveCanonicalTable(statement, entryLines) {
  const lines = statement.raw.split("\n");

  if (lines.length < 2) {
    return null;
  }

  const header = `CREATE TABLE ${statement.ifNotExists ? "IF NOT EXISTS " : ""}${statement.name} (`;
  const closing = statement.suffix ? `) ${formatStructuralSql(statement.suffix)}` : ")";

  if (lines[0].trim() !== header || lines.at(-1)?.trim() !== closing) {
    return null;
  }

  const body = lines.slice(1, -1).map((line) => line.trimStart());

  if (body.some((line) => line.length === 0) || body.length !== entryLines.length) {
    return null;
  }

  if (body.some((line, index) => !hasEquivalentLineContent(line, entryLines[index]))) {
    return null;
  }

  return [header, ...body.map((line) => `  ${line}`), `${closing};`].join("\n");
}

function hasEquivalentLineContent(left, right) {
  const leftHasComma = left.endsWith(",");
  const rightHasComma = right.endsWith(",");

  if (leftHasComma !== rightHasComma) {
    return false;
  }

  const leftContent = leftHasComma ? left.slice(0, -1) : left;
  const rightContent = rightHasComma ? right.slice(0, -1) : right;

  return normalizeInlineSql(leftContent) === normalizeInlineSql(rightContent);
}

function normalizeInlineSql(source) {
  return source.replace(/\s+/g, " ").trim();
}
