# @lebedevna/prettier-plugin-sql

Prettier plugin for formatting a focused subset of PostgreSQL DDL.

The plugin is intentionally narrow. It formats supported statements into the house style shown in [`example.sql`](./example.sql) and leaves everything else structurally unchanged.

## Install

```bash
npm install --save-dev prettier @lebedevna/prettier-plugin-sql
```

Peer requirement: `prettier@^3`.

## Usage

### Prettier config

```js
// prettier.config.js
import sqlPlugin from "@lebedevna/prettier-plugin-sql";

export default {
  plugins: [sqlPlugin],
};
```

If you use JSON config, reference the package name:

```json
{
  "plugins": ["@lebedevna/prettier-plugin-sql"]
}
```

### Format SQL files

```bash
npx prettier --write schema.sql
```

The plugin registers the `sql` parser for `.sql` files.

## Example

Input:

```sql
create table job(
  job_id integer generated always as identity,
  created_at timestamp not null,
  is_active boolean not null default true,
  constraint status_fk foreign key(status_id) references dict_job_status(id)
) partition by range(created_at)
```

Output:

```sql
CREATE TABLE job (
    job_id     integer   GENERATED ALWAYS AS IDENTITY,
    created_at timestamp NOT NULL,
    is_active  boolean   NOT NULL DEFAULT true,
    CONSTRAINT status_fk FOREIGN KEY (status_id) REFERENCES dict_job_status (id)
) PARTITION BY RANGE (created_at);
```

## Supported Statements

- `CREATE DOMAIN ... AS ...`
- `CREATE TYPE ... AS ENUM (...)`
- `CREATE TABLE ...`

## Supported Table Formatting

For supported `CREATE TABLE` statements, the formatter currently handles:

- column definitions
- quoted identifiers
- table constraints such as `PRIMARY KEY`, `UNIQUE`, and `FOREIGN KEY ... REFERENCES ...`
- `GENERATED ALWAYS AS IDENTITY`
- `DEFAULT ...`
- explicit `NULL` and `NOT NULL`
- inline `--` comments placed above columns or constraints
- `PARTITION BY RANGE (...)`

## Behavior

- Uppercases supported structural keywords while preserving identifier case and string literals
- Aligns column names, data types, and nullability within a table
- Reorders nullability ahead of trailing clauses such as `DEFAULT`
- Preserves unsupported statements instead of trying to restyle them
- Normalizes the final output to include a trailing semicolon and newline
- Throws on invalid PostgreSQL syntax instead of guessing

## Unsupported SQL

Unsupported SQL is passed through with minimal normalization. For example, a `SELECT` statement is kept as-is apart from trailing semicolon cleanup.

This makes the plugin safe to use on mixed files only if you are comfortable with supported PostgreSQL DDL being reformatted while unsupported SQL mostly stays in its original layout.

## Limitations

- This is not a general-purpose SQL formatter
- The scope is PostgreSQL-oriented DDL, not multi-dialect SQL
- `CREATE TABLE` support is limited to tables the parser can map into the plugin's supported entry model
- There are currently no plugin-specific options

## Development

```bash
npm test
```
