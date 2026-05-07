import { parse } from "./parser.js";
import { printSql } from "./printer.js";

const languages = [
  {
    name: "SQL",
    parsers: ["sql"],
    extensions: [".sql"],
    tmScope: "source.sql",
    aceMode: "sql",
    linguistLanguageId: 327
  }
];

const parsers = {
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
    }
  }
};

const printers = {
  sql: {
    print(path) {
      return printSql(path.getValue());
    }
  }
};

export default {
  languages,
  parsers,
  printers
};

export { languages, parsers, printers };
