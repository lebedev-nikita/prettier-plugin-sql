import type {
  ColumnEntry,
  CreateIndexStatement,
  CreateTableStatement,
  SqlRootNode,
  SqlStatement,
} from "./types.js";

const STRUCTURAL_KEYWORDS = new Set([
  "by",
  "constraint",
  "foreign",
  "key",
  "partition",
  "primary",
  "range",
  "references",
  "unique",
]);
const COLUMN_EXTRA_KEYWORDS = new Set([
  "always",
  "as",
  "cascade",
  "check",
  "collate",
  "constraint",
  "default",
  "delete",
  "foreign",
  "generated",
  "identity",
  "key",
  "no",
  "not",
  "null",
  "on",
  "primary",
  "references",
  "restrict",
  "set",
  "stored",
  "unique",
  "update",
]);
const INDEX_KEYWORDS = new Set([
  "concurrently",
  "create",
  "exists",
  "if",
  "include",
  "index",
  "not",
  "on",
  "using",
  "unique",
  "where",
]);

type PrintOptions = {};

const SQL_TAB_WIDTH = 4;

export function printSql(ast: SqlRootNode, options: PrintOptions = {}): string {
  const indentation = " ".repeat(SQL_TAB_WIDTH);
  const body = ast.statements
    .map((statement) => printStatement(statement, indentation))
    .join("\n\n");
  return body ? `${body}\n` : "";
}

function printStatement(statement: SqlStatement, indentation: string): string {
  switch (statement.type) {
    case "create_domain":
      return `CREATE DOMAIN ${statement.name} AS ${formatDataType(statement.dataType)};`;
    case "create_type_enum":
      return [
        `CREATE TYPE ${statement.name} AS ENUM (`,
        ...statement.items.map(
          (item, index) => `${indentation}${item}${index === statement.items.length - 1 ? "" : ","}`
        ),
        ");",
      ].join("\n");
    case "create_table":
      return printCreateTable(statement, indentation);
    case "create_index":
      return printCreateIndex(statement);
    case "unsupported":
      return normalizeUnsupported(statement.raw);
  }
}

function printCreateIndex(statement: CreateIndexStatement): string {
  const head = [
    "CREATE",
    statement.unique ? "UNIQUE" : "",
    "INDEX",
    statement.concurrently ? "CONCURRENTLY" : "",
    statement.ifNotExists ? "IF NOT EXISTS" : "",
    statement.name,
    "ON",
    statement.relation,
  ].filter(Boolean);
  const lines = [head.join(" ")];
  const params = statement.params.map((param) => formatStructuralSql(param)).join(", ");

  if (statement.accessMethod) {
    lines.push(`USING ${statement.accessMethod} (${params})${formatCreateIndexSuffix(statement.suffix)};`);
  } else {
    lines[0] += ` (${params})${formatCreateIndexSuffix(statement.suffix)};`;
  }

  return lines.join("\n");
}

function printCreateTable(statement: CreateTableStatement, indentation: string): string {
  const columns = statement.entries.filter((entry) => entry.type === "column");
  const nameWidth = Math.max(...columns.map((entry) => entry.name.length), 0);
  const typeWidth = Math.max(...columns.map((entry) => formatDataType(entry.dataType).length), 0);
  const nullWidth = Math.max(...columns.map((entry) => entry.nullability.length), 0);
  const entryLines: string[] = [];

  statement.entries.forEach((entry, index) => {
    const isLast = index === statement.entries.length - 1;

    if (entry.type === "comment_only") {
      entryLines.push(...entry.comments);
      return;
    }

    if (entry.comments.length > 0) {
      entryLines.push(...entry.comments);
    }

    const content =
      entry.type === "column"
        ? formatColumn(entry, { nameWidth, typeWidth, nullWidth })
        : formatStructuralSql(entry.content);

    entryLines.push(`${content}${isLast ? "" : ","}`);
  });

  const lines = [
    `CREATE TABLE ${statement.ifNotExists ? "IF NOT EXISTS " : ""}${statement.name} (`,
  ];
  lines.push(...entryLines.map((line) => `${indentation}${line}`));

  let closing = ")";

  if (statement.suffix) {
    closing += ` ${formatStructuralSql(statement.suffix)}`;
  }

  lines.push(`${closing};`);
  return lines.join("\n");
}

function formatColumn(
  entry: ColumnEntry,
  widths: { nameWidth: number; typeWidth: number; nullWidth: number }
): string {
  const dataType = formatDataType(entry.dataType);
  const base = `${entry.name.padEnd(widths.nameWidth)} ${dataType.padEnd(widths.typeWidth)}`;
  const extras = entry.extras ? formatColumnExtras(entry.extras) : "";

  if (!entry.nullability) {
    return (extras ? `${base} ${extras}` : base).trimEnd();
  }

  const renderedNullability = entry.nullability.toUpperCase();
  const nullability =
    entry.nullability === "not null"
      ? renderedNullability
      : renderedNullability.padStart(widths.nullWidth);
  const suffix = extras ? ` ${extras}` : "";
  return `${base} ${nullability}${suffix}`.trimEnd();
}

function formatDataType(source: string): string {
  let result = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const flushToken = (): void => {
    result += token.toLowerCase();
    token = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

    if (!inDoubleQuote && char === "'") {
      flushToken();
      result += char;

      if (inSingleQuote && source[index + 1] === "'") {
        result += source[index + 1];
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && char === '"') {
      flushToken();
      result += char;

      if (inDoubleQuote && source[index + 1] === '"') {
        result += source[index + 1];
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      result += char;
    } else if (/[A-Za-z_]/.test(char)) {
      token += char;
    } else {
      flushToken();
      result += char;
    }
  }

  flushToken();
  return result;
}

function formatStructuralSql(source: string): string {
  const normalized = normalizeKeywordCasing(source, STRUCTURAL_KEYWORDS);
  return normalized
    .replace(/([A-Za-z_"][A-Za-z0-9_"]*)\(/g, "$1 (")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function formatColumnExtras(source: string): string {
  return normalizeReferenceClauseSpacing(normalizeKeywordCasing(source, COLUMN_EXTRA_KEYWORDS));
}

function normalizeReferenceClauseSpacing(source: string): string {
  return source.replace(
    /\b(REFERENCES\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))*)\s*\(\s*([^)]*?)\s*\)/g,
    "$1 ($2)",
  );
}

function formatCreateIndexSuffix(source: string): string {
  if (!source) {
    return "";
  }

  return ` ${normalizeKeywordCasing(source, INDEX_KEYWORDS)}`;
}

function normalizeKeywordCasing(source: string, keywords: Set<string>): string {
  let result = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const flushToken = (): void => {
    if (!token) {
      return;
    }

    const lowerToken = token.toLowerCase();
    result += keywords.has(lowerToken) ? lowerToken.toUpperCase() : token;
    token = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

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
  return result;
}

function normalizeUnsupported(source: string): string {
  const normalized = source
    .trim()
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();

  if (/^create\s+(unique\s+)?index\b/i.test(normalized)) {
    return `${normalizeKeywordCasing(normalized, INDEX_KEYWORDS)};`;
  }

  return `${normalized};`;
}
