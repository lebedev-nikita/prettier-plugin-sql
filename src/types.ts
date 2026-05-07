export type SqlRootNode = {
  type: "sql-root";
  raw: string;
  statements: SqlStatement[];
};

export type SqlStatement =
  | CreateDomainStatement
  | CreateTypeEnumStatement
  | CreateTableStatement
  | UnsupportedStatement;

export type CreateDomainStatement = {
  type: "create_domain";
  name: string;
  dataType: string;
  raw: string;
};

export type CreateTypeEnumStatement = {
  type: "create_type_enum";
  name: string;
  items: string[];
  raw: string;
};

export type CreateTableStatement = {
  type: "create_table";
  ifNotExists: boolean;
  name: string;
  entries: TableEntry[];
  suffix: string;
  raw: string;
};

export type UnsupportedStatement = {
  type: "unsupported";
  raw: string;
};

export type TableEntry = ColumnEntry | ConstraintEntry | CommentOnlyEntry;

export type ColumnEntry = {
  type: "column";
  comments: string[];
  name: string;
  dataType: string;
  nullability: string;
  extras: string;
  raw: string;
};

export type ConstraintEntry = {
  type: "constraint";
  comments: string[];
  content: string;
  raw: string;
};

export type CommentOnlyEntry = {
  type: "comment_only";
  comments: string[];
  raw: string;
};

export type NullabilityParts = {
  nullability: string;
  extras: string;
};

export type NullabilityMatch = {
  start: number;
  end: number;
  value: string;
};

export type ParsedComments = {
  comments: string[];
  content: string;
};

export type SqlAstNode = SqlRootNode | SqlStatement | TableEntry;
