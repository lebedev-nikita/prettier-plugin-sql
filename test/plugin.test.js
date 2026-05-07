import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dedent from "dedent-js";
import prettier from "prettier";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(rootDir, "../example.sql");
const exampleSql = readFileSync(fixturePath, "utf8");

async function format(source) {
  return prettier.format(source, {
    parser: "sql",
    plugins: [plugin]
  });
}

describe("prettier-plugin-sql", () => {
  it("formats the canonical example fixture exactly", async () => {
    await expect(format(exampleSql)).resolves.toBe(exampleSql);
  });

  it("is idempotent for the canonical example fixture", async () => {
    const once = await format(exampleSql);
    const twice = await format(once);

    expect(twice).toBe(once);
  });

  it("formats supported PostgreSQL DDL statements", async () => {
    const input = dedent`
      create domain js_date as timestamptz(3);
      create type ai_request_type as enum('text','code');
      create table if not exists database_x_user(
        login text not null,
        database text not null,
        is_personal boolean not null,
        constraint database_x_user_un unique(login, database)
      );
    `;

    const expected = `${dedent`
      CREATE DOMAIN js_date AS timestamptz(3);

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
    `}\n`;

    await expect(format(input)).resolves.toBe(expected);
  });

  it("preserves comments and partition clauses in supported tables", async () => {
    const input = dedent`
      create table job(
        job_id integer generated always as identity,
        -- important note
        created_at timestamp not null,
        constraint status_fk foreign key(status_id) references dict_job_status(id)
      ) partition by range(created_at);
    `;

    const expected = `${dedent`
      CREATE TABLE job (
        job_id     integer   generated always as identity,
        -- important note
        created_at timestamp not null,
        CONSTRAINT status_fk FOREIGN KEY (status_id) REFERENCES dict_job_status (id)
      ) PARTITION BY RANGE (created_at);
    `}\n`;

    await expect(format(input)).resolves.toBe(expected);
  });

  it("leaves unsupported SQL unchanged apart from trailing semicolon normalization", async () => {
    const input = "select * from users where id = 1";
    await expect(format(input)).resolves.toBe("select * from users where id = 1;\n");
  });
});
