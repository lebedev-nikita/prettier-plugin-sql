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
  "collate"
]);

export function parse(text) {
  const statements = splitStatements(text).map((statement) => parseStatement(statement));

  return {
    type: "sql-root",
    raw: text,
    statements
  };
}

function parseStatement(rawStatement) {
  const statement = rawStatement.trim();

  return (
    parseCreateDomain(statement) ??
    parseCreateType(statement) ??
    parseCreateTable(statement) ?? {
      type: "unsupported",
      raw: statement
    }
  );
}

function parseCreateDomain(statement) {
  const match = statement.match(/^create\s+domain\s+(.+?)\s+as\s+(.+)$/is);

  if (!match) {
    return null;
  }

  return {
    type: "create_domain",
    name: match[1].trim(),
    dataType: normalizeInlineSql(match[2]),
    raw: statement
  };
}

function parseCreateType(statement) {
  const match = statement.match(/^create\s+type\s+(.+?)\s+as\s+enum\s*\(([\s\S]*)\)$/i);

  if (!match) {
    return null;
  }

  const items = splitCommaSeparated(match[2]).map((item) => normalizeInlineSql(item));

  return {
    type: "create_type_enum",
    name: match[1].trim(),
    items,
    raw: statement
  };
}

function parseCreateTable(statement) {
  const headerMatch = statement.match(/^create\s+table\s+(if\s+not\s+exists\s+)?(.+?)\s*\(/i);

  if (!headerMatch) {
    return null;
  }

  const bodyStart = statement.indexOf("(", headerMatch[0].length - 1);
  const bodyEnd = findMatchingParen(statement, bodyStart);

  if (bodyStart === -1 || bodyEnd === -1) {
    return null;
  }

  const body = statement.slice(bodyStart + 1, bodyEnd);
  const suffix = normalizeInlineSql(statement.slice(bodyEnd + 1));
  const entries = splitTableEntries(body).map(parseTableEntry);

  if (entries.some((entry) => entry == null)) {
    return null;
  }

  return {
    type: "create_table",
    ifNotExists: Boolean(headerMatch[1]),
    name: headerMatch[2].trim(),
    entries,
    suffix,
    raw: statement
  };
}

function parseTableEntry(entry) {
  const trimmed = entry.trim();

  if (!trimmed) {
    return null;
  }

  const { comments, content } = extractLeadingComments(trimmed);

  if (!content) {
    return {
      type: "comment_only",
      comments,
      raw: entry
    };
  }

  if (/^constraint\b/i.test(content)) {
    return {
      type: "constraint",
      comments,
      content: normalizeInlineSql(content),
      raw: entry
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
    const token = tokens[index].toLowerCase();

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

  return {
    type: "column",
    comments,
    name: firstPart,
    dataType,
    nullability,
    extras,
    raw: entry
  };
}

function splitNullability(clause) {
  if (!clause) {
    return { nullability: "", extras: "" };
  }

  const tokens = tokenizeSqlSegments(clause);
  const nullabilityMatch = findNullabilityTokens(tokens);

  if (nullabilityMatch) {
    const extrasTokens = tokens.filter(
      (_, index) => index < nullabilityMatch.start || index >= nullabilityMatch.end
    );

    return {
      nullability: nullabilityMatch.value,
      extras: normalizeInlineSql(extrasTokens.join(" "))
    };
  }

  return {
    nullability: "",
    extras: clause
  };
}

function findNullabilityTokens(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLowerCase();
    const nextToken = tokens[index + 1]?.toLowerCase();
    const previousToken = tokens[index - 1]?.toLowerCase();

    if (token === "not" && nextToken === "null") {
      return {
        start: index,
        end: index + 2,
        value: "not null"
      };
    }

    if (token === "null" && previousToken !== "default") {
      return {
        start: index,
        end: index + 1,
        value: "null"
      };
    }
  }

  return null;
}

function splitStatements(source) {
  const statements = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
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

function splitCommaSeparated(source) {
  const values = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "'" && source[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote) {
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
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();

  if (tail) {
    values.push(tail);
  }

  return values;
}

function splitTableEntries(source) {
  const entries = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
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

function tokenizeSqlSegments(source) {
  const tokens = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

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

function extractLeadingComments(entry) {
  const comments = [];
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
    content: remaining
  };
}

function readIdentifier(source) {
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

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
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

function normalizeInlineSql(source) {
  return source.replace(/\s+/g, " ").trim();
}
