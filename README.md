# @lebedevna/prettier-plugin-sql

Prettier plugin for formatting PostgreSQL DDL.

This package currently targets the house style shown in [`example.sql`](./example.sql). It is focused on a small supported subset of PostgreSQL schema statements rather than general SQL formatting.

## Install

```bash
npm install --save-dev prettier @lebedevna/prettier-plugin-sql
```

## Usage

### Prettier config

```js
// prettier.config.js
import sqlPlugin from "@lebedevna/prettier-plugin-sql";

export default {
  plugins: [sqlPlugin]
};
```

If you are using JSON config, point Prettier at the package name:

```json
{
  "plugins": ["@lebedevna/prettier-plugin-sql"]
}
```

### Format a file

```bash
npx prettier --write schema.sql
```

The plugin registers the `sql` parser for `.sql` files.

## Example

Input:

```sql
create type ai_request_type as enum('text','code');
create table if not exists database_x_user(
  login text not null,
  database text not null,
  is_personal boolean not null,
  constraint database_x_user_un unique(login, database)
);
```

Output:

```sql
CREATE TYPE ai_request_type AS ENUM (
  'text',
  'code'
);

CREATE TABLE IF NOT EXISTS database_x_user (
  login       text    not null,
  database    text    not null,
  is_personal boolean not null,
  CONSTRAINT database_x_user_un UNIQUE (login, database)
);
```

## Supported Syntax

- `CREATE DOMAIN ... AS ...`
- `CREATE TYPE ... AS ENUM (...)`
- `CREATE TABLE ...` with:
  - columns
  - `CONSTRAINT` entries
  - `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, `REFERENCES`
  - inline `--` comments
  - `PARTITION BY RANGE (...)`

## Current Behavior

- Formats supported PostgreSQL DDL statements into the canonical style used in `example.sql`
- Preserves already-canonical multi-line table formatting byte-for-byte
- Leaves unsupported SQL unchanged, except it normalizes a missing trailing semicolon

## Limitations

- This is not a general-purpose SQL formatter yet
- It is designed for PostgreSQL DDL, not multi-dialect SQL
- Unsupported statements such as `SELECT` are not reformatted into a new style
- There are no custom plugin options in `v0.1.0`

## Development

Run tests with:

```bash
npm test
```
