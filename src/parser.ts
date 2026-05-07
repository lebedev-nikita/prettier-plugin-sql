import { loadModule, parseSync } from "pgsql-parser";
import type {
  CreateDomainStmt,
  CreateEnumStmt,
  CreateStmt,
  Node,
  ParseResult,
  RawStmt,
} from "@pgsql/types";
import type {
  CreateDomainStatement,
  CreateTableStatement,
  CreateTypeEnumStatement,
  NullabilityMatch,
  NullabilityParts,
  ParsedComments,
  SqlRootNode,
  SqlStatement,
  TableEntry,
} from "./types.js";

await loadModule();

const CLAUSE_STARTERS = new Set([
  "not",
  "null",
  "default",
  "generated",
  "constraint",
  "primary",
  "unique",
  "references",
  "check",
  "collate",
]);

export function parse(text: string): SqlRootNode {
  const parsed = parseSync(text) as ParseResult;
  const rawStatements = splitStatements(text);
  const statements = (parsed.stmts ?? []).map((statement, index, allStatements) =>
    parseStatement(text, rawStatements[index], statement, index, allStatements),
  );

  return {
    type: "sql-root",
    raw: text,
    statements,
  };
}

function parseStatement(
  source: string,
  rawStatement: string | undefined,
  statement: RawStmt,
  index: number,
  allStatements: RawStmt[],
): SqlStatement {
  const raw = rawStatement ?? sliceStatementSource(source, statement, allStatements[index + 1]);
  const node = statement.stmt;

  if (node && "CreateDomainStmt" in node) {
    return parseCreateDomain(node.CreateDomainStmt, raw) ?? unsupportedStatement(raw);
  }

  if (node && "CreateEnumStmt" in node) {
    return parseCreateType(node.CreateEnumStmt, raw) ?? unsupportedStatement(raw);
  }

  if (node && "CreateStmt" in node) {
    return parseCreateTable(node.CreateStmt, raw) ?? unsupportedStatement(raw);
  }

  return unsupportedStatement(raw);
}

function parseCreateDomain(
  statement: CreateDomainStmt,
  rawStatement: string,
): CreateDomainStatement | null {
  const dataTypeMatch = rawStatement.match(/^create\s+domain\s+.+?\s+as\s+(.+)$/is);
  const name = joinQualifiedName(statement.domainname);

  if (!dataTypeMatch || !name) {
    return null;
  }

  return {
    type: "create_domain",
    name,
    dataType: normalizeInlineSql(dataTypeMatch[1]!),
    raw: rawStatement,
  };
}

function parseCreateType(
  statement: CreateEnumStmt,
  rawStatement: string,
): CreateTypeEnumStatement | null {
  const name = joinQualifiedName(statement.typeName);
  const items = (statement.vals ?? []).map((node) => {
    const value = readStringNode(node);
    return value ? `'${value.replace(/'/g, "''")}'` : "";
  });

  if (!name || items.some((item) => !item)) {
    return null;
  }

  return {
    type: "create_type_enum",
    name,
    items: items as string[],
    raw: rawStatement,
  };
}

function parseCreateTable(statement: CreateStmt, rawStatement: string): CreateTableStatement | null {
  if (!isSupportedCreateTable(statement)) {
    return null;
  }

  const headerMatch = rawStatement.match(/^create\s+table\s+(if\s+not\s+exists\s+)?(.+?)\s*\(/i);

  if (!headerMatch) {
    return null;
  }

  const bodyStart = rawStatement.indexOf("(", headerMatch[0].length - 1);
  const bodyEnd = findMatchingParen(rawStatement, bodyStart);

  if (bodyStart === -1 || bodyEnd === -1) {
    return null;
  }

  const body = rawStatement.slice(bodyStart + 1, bodyEnd);
  const suffix = normalizeInlineSql(rawStatement.slice(bodyEnd + 1));
  const rawEntries = splitTableEntries(body);
  const entries = rawEntries
    .map(parseTableEntry)
    .filter((entry): entry is TableEntry => entry !== null);
  const nonCommentEntries = rawEntries.filter((entry) => extractLeadingComments(entry).content).length;

  if (entries.length !== rawEntries.length || nonCommentEntries !== (statement.tableElts ?? []).length) {
    return null;
  }

  return {
    type: "create_table",
    ifNotExists: Boolean(statement.if_not_exists),
    name: headerMatch[2]!.trim(),
    entries,
    suffix,
    raw: rawStatement,
  };
}

function unsupportedStatement(rawStatement: string): SqlStatement {
  return {
    type: "unsupported",
    raw: normalizeStatementSource(rawStatement),
  };
}

function isSupportedCreateTable(statement: CreateStmt): boolean {
  const entries = statement.tableElts ?? [];

  return entries.every((entry) => {
    if ("ColumnDef" in entry) {
      return true;
    }

    return "Constraint" in entry;
  });
}

function readStringNode(node: Node): string {
  return "String" in node ? (node.String.sval ?? "") : "";
}

function joinQualifiedName(nodes: Node[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      const value = readStringNode(node);
      return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
    })
    .join(".");
}

function sliceStatementSource(source: string, statement: RawStmt, nextStatement?: RawStmt): string {
  const start = statement.stmt_location ?? 0;
  const end =
    nextStatement?.stmt_location ??
    ((statement.stmt_len ?? 0) > 0 ? start + (statement.stmt_len ?? 0) : source.length);

  return normalizeStatementSource(source.slice(start, end));
}

function normalizeStatementSource(source: string): string {
  return source.trim().replace(/;+\s*$/, "");
}

function parseTableEntry(entry: string): TableEntry | null {
  const trimmed = entry.trim();

  if (!trimmed) {
    return null;
  }

  const { comments, content } = extractLeadingComments(trimmed);

  if (!content) {
    return {
      type: "comment_only",
      comments,
      raw: entry,
    };
  }

  if (/^constraint\b/i.test(content)) {
    return {
      type: "constraint",
      comments,
      content: normalizeInlineSql(content),
      raw: entry,
    };
  }

  const firstPart = readIdentifier(content);

  if (!firstPart) {
    return null;
  }

  const remainder = content.slice(firstPart.length).trimStart();
  const tokens = tokenizeSqlSegments(remainder);
  let clauseIndex = tokens.length;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!.toLowerCase();

    if (CLAUSE_STARTERS.has(token)) {
      clauseIndex = index;
      break;
    }
  }

  if (clauseIndex === 0) {
    return null;
  }

  const dataType = normalizeInlineSql(tokens.slice(0, clauseIndex).join(" "));
  const clause = normalizeInlineSql(tokens.slice(clauseIndex).join(" "));
  const { nullability, extras } = splitNullability(clause);
  const normalizedNullability = clause ? nullability : "null";

  return {
    type: "column",
    comments,
    name: firstPart,
    dataType,
    nullability: normalizedNullability,
    extras,
    raw: entry,
  };
}

function splitNullability(clause: string): NullabilityParts {
  if (!clause) {
    return { nullability: "", extras: "" };
  }

  const tokens = tokenizeSqlSegments(clause);
  const nullabilityMatch = findNullabilityTokens(tokens);

  if (nullabilityMatch) {
    const extrasTokens = tokens.filter(
      (_, index) => index < nullabilityMatch.start || index >= nullabilityMatch.end,
    );

    return {
      nullability: nullabilityMatch.value,
      extras: normalizeInlineSql(extrasTokens.join(" ")),
    };
  }

  return {
    nullability: "",
    extras: clause,
  };
}

function findNullabilityTokens(tokens: string[]): NullabilityMatch | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!.toLowerCase();
    const nextToken = tokens[index + 1]?.toLowerCase();
    const previousToken = tokens[index - 1]?.toLowerCase();

    if (token === "not" && nextToken === "null") {
      return {
        start: index,
        end: index + 2,
        value: "not null",
      };
    }

    if (token === "null" && previousToken !== "default") {
      return {
        start: index,
        end: index + 1,
        value: "null",
      };
    }
  }

  return null;
}

function splitTableEntries(source: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (!inDoubleQuote && char === "'" && source[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      continue;
    }

    if (char === "," && depth === 0) {
      entries.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();

  if (tail) {
    entries.push(tail);
  }

  return entries.filter(Boolean);
}

function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "$") {
      const dollarQuoteMatch = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);

      if (dollarQuoteMatch) {
        const tag = dollarQuoteMatch[0]!;

        if (dollarQuoteTag === tag) {
          dollarQuoteTag = null;
        } else if (dollarQuoteTag === null) {
          dollarQuoteTag = tag;
        }

        index += tag.length - 1;
        continue;
      }
    }

    if (dollarQuoteTag) {
      continue;
    }

    if (!inDoubleQuote && char === "'" && source[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      continue;
    }

    if (char === ";" && depth === 0) {
      const statement = source.slice(start, index).trim();

      if (statement) {
        statements.push(statement);
      }

      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();

  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function tokenizeSqlSegments(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

    if (!inDoubleQuote && char === "'" && source[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      current += char;
      continue;
    }

    if (/\s/.test(char) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function extractLeadingComments(entry: string): ParsedComments {
  const comments: string[] = [];
  let remaining = entry;

  while (remaining.startsWith("--")) {
    const newlineIndex = remaining.indexOf("\n");

    if (newlineIndex === -1) {
      comments.push(remaining.trim());
      remaining = "";
      break;
    }

    comments.push(remaining.slice(0, newlineIndex).trimEnd());
    remaining = remaining.slice(newlineIndex + 1).trimStart();
  }

  return {
    comments,
    content: remaining,
  };
}

function readIdentifier(source: string): string {
  if (!source) {
    return "";
  }

  if (source.startsWith('"')) {
    const end = source.indexOf('"', 1);
    return end === -1 ? "" : source.slice(0, end + 1);
  }

  const match = source.match(/^[^\s]+/);
  return match ? match[0] : "";
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]!;
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (!inDoubleQuote && char === "'" && source[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function normalizeInlineSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}
