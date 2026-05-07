import type { ColumnEntry, CreateTableStatement, SqlRootNode, SqlStatement } from "./types.js";

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
      return `CREATE DOMAIN ${statement.name} AS ${statement.dataType};`;
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
    case "unsupported":
      return normalizeUnsupported(statement.raw);
  }
}

function printCreateTable(statement: CreateTableStatement, indentation: string): string {
  const columns = statement.entries.filter((entry) => entry.type === "column");
  const nameWidth = Math.max(...columns.map((entry) => entry.name.length), 0);
  const typeWidth = Math.max(...columns.map((entry) => entry.dataType.length), 0);
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
  const base = `${entry.name.padEnd(widths.nameWidth)} ${entry.dataType.padEnd(widths.typeWidth)}`;

  if (!entry.nullability) {
    return (entry.extras ? `${base} ${entry.extras}` : base).trimEnd();
  }

  const nullability =
    entry.nullability === "not null"
      ? entry.nullability
      : entry.nullability.padStart(widths.nullWidth);
  const suffix = entry.extras ? ` ${entry.extras}` : "";
  return `${base} ${nullability}${suffix}`.trimEnd();
}

function formatStructuralSql(source: string): string {
  let result = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const flushToken = (): void => {
    if (!token) {
      return;
    }

    const lowerToken = token.toLowerCase();
    result += STRUCTURAL_KEYWORDS.has(lowerToken) ? lowerToken.toUpperCase() : token;
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
  return result.replace(/([A-Za-z_"][A-Za-z0-9_"]*)\(/g, "$1 (");
}

function normalizeUnsupported(source: string): string {
  return `${source
    .trim()
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd()};`;
}
