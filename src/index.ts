import { parse } from "./parser.js";
import { printSql } from "./printer.js";
import type { SqlAstNode } from "./types.js";

type SqlParser = {
  parse(text: string): SqlAstNode;
  astFormat: "sql";
  locStart(): number;
  locEnd(node: { raw: string }): number;
};

type SqlPrinterPath = {
  getValue(): SqlAstNode;
};

type SqlPrinter = {
  print(path: SqlPrinterPath): string;
};

type SqlPlugin = {
  languages: Array<{
    name: string;
    parsers: string[];
    extensions: string[];
    tmScope: string;
    aceMode: string;
    linguistLanguageId: number;
  }>;
  parsers: Record<"sql", SqlParser>;
  printers: Record<"sql", SqlPrinter>;
};

const languages: SqlPlugin["languages"] = [
  {
    name: "SQL",
    parsers: ["sql"],
    extensions: [".sql"],
    tmScope: "source.sql",
    aceMode: "sql",
    linguistLanguageId: 327,
  },
];

const parsers: SqlPlugin["parsers"] = {
  sql: {
    parse(text) {
      return parse(text);
    },
    astFormat: "sql",
    locStart() {
      return 0;
    },
    locEnd(node) {
      return node.raw.length;
    },
  },
};

const printers: SqlPlugin["printers"] = {
  sql: {
    print(path) {
      return printSql(path.getValue() as ReturnType<typeof parse>);
    },
  },
};

const plugin: SqlPlugin = {
  languages,
  parsers,
  printers,
};

export default plugin;

export { languages, parsers, printers };
