import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dedent from "dedent-js";
import prettier from "prettier";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";
import { exec } from "node:child_process";
import { deepEqual } from "node:assert";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(rootDir, "../example.sql");
const exampleSql = readFileSync(fixturePath, "utf8");

async function format(source: string): Promise<string> {
  return prettier.format(source, {
    parser: "sql",
    plugins: [plugin],
  });
}

async function expectFormat(input: string, expected: string): Promise<void> {
  await expect(format(input)).resolves.toBe(expected);
}

describe("prettier-plugin-sql", () => {
  describe("general", () => {
    it("formats the canonical example fixture exactly", async () => {
      await expect(format(exampleSql)).resolves.toBe(exampleSql);
    });

    it("formats multiple supported statements from one input through the PostgreSQL parser", async () => {
      const input = dedent`
        create domain js_date as timestamptz(3);
        create type ai_request_type as enum('text','code');
      `;
      const expected = dedent`
        CREATE DOMAIN js_date AS timestamptz(3);

        CREATE TYPE ai_request_type AS ENUM (
            'text',
            'code'
        );

      `;

      await expectFormat(input, expected);
    });

    it("is idempotent for the canonical example fixture", async () => {
      const once = await format(exampleSql);
      const twice = await format(once);

      expect(twice).toBe(once);
    });

    it("normalizes create domain statements with irregular casing and spacing", async () => {
      const input = "cReAtE   domain   js_date    as   timestamptz(3)";
      await expectFormat(input, "CREATE DOMAIN js_date AS timestamptz(3);\n");
    });

    it("normalizes create type enum statements from compact one-line input", async () => {
      const input = "create type ai_request_type as enum('text','code')";
      const expected = dedent`
        CREATE TYPE ai_request_type AS ENUM (
            'text',
            'code'
        );

      `;

      await expectFormat(input, expected);
    });

    it("normalizes create type enum statements with awkward line breaks", async () => {
      const input = dedent`
        create type ai_request_type
        as enum(
        'text'
        ,
          'code'
        )
      `;
      const expected = dedent`
        CREATE TYPE ai_request_type AS ENUM (
            'text',
            'code'
        );

      `;

      await expectFormat(input, expected);
    });

    it("formats create table statements with column alignment and unique constraints", async () => {
      const input = dedent`
        create table if not exists database_x_user(
        login text not null,
          database text not null,
        is_personal boolean not null,
        constraint database_x_user_un unique(login, database)
        )
      `;
      const expected = dedent`
        CREATE TABLE IF NOT EXISTS database_x_user (
            login       text    NOT NULL,
            database    text    NOT NULL,
            is_personal boolean NOT NULL,
            CONSTRAINT database_x_user_un UNIQUE (login, database)
        );

      `;

      await expectFormat(input, expected);
    });

    describe("functions", () => {
      it("does not delete function body", async () => {
        const input = dedent`
          CREATE OR REPLACE FUNCTION public.get_static_data()
              RETURNS TABLE(norm_id text, label_data jsonb, iref_after_queries jsonb, iref_spec_queries jsonb, size text, updated_at timestamp without time zone)
              LANGUAGE 'plpgsql'
              VOLATILE
              PARALLEL UNSAFE
              COST 100    ROWS 1000
          AS $BODY$
          DECLARE
              v_big_threshold INT := 1000;
              v_middle_threshold INT := 100;
          BEGIN
              -- step 1
              -- step 2
          END;
          $BODY$;
        `;
        const output = await format(input);

        const wordCount = (str: string) => str.split(/\s+/).length;

        expect(wordCount(output)).toBeGreaterThan(wordCount(input) - 3);
      });
    });

    it("does not delete empty lines between function statements", async () => {
      const input = dedent`
        CREATE OR REPLACE FUNCTION public.get_static_data()
            RETURNS TABLE(norm_id text, label_data jsonb, iref_after_queries jsonb, iref_spec_queries jsonb, size text, updated_at timestamp without time zone)
            LANGUAGE 'plpgsql'
            VOLATILE
            PARALLEL UNSAFE
            COST 100    ROWS 1000
        AS $BODY$
        DECLARE
            v_big_threshold INT := 1000;
            v_middle_threshold INT := 100;
        BEGIN
            -- Логируем начало процесса
            RAISE NOTICE 'Начало выполнения функции get_static_data';

            -- Шаг 1: Создаем временную таблицу для spec с определением размера
            RAISE NOTICE 'Шаг 1/4: Создание временной таблицы temp_spec с определением размера норм...';
        END;
        $BODY$;
      `;

      const output = await format(input);

      expect(output.split(/\n\n+/).length).toBe(2);
    });

    it("formats generated always as identity columns from compact input", async () => {
      const input = "create table job(job_id integer generated always as identity)";
      const expected = dedent`
        CREATE TABLE job (
            job_id integer GENERATED ALWAYS AS IDENTITY
        );

      `;

      await expectFormat(input, expected);
    });

    it("does not add NULL to the end of primary key", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS static (
            norm_id            bigint    NULL,
            label_data         jsonb     NULL,
            iref_after_queries jsonb     NULL,
            iref_spec_queries  jsonb     NULL,
            size               norm_size NULL,
            updated_at         js_date   NULL,
            PRIMARY KEY (norm_id, updatedat)
        );
      `;
      const output = dedent`
        CREATE TABLE IF NOT EXISTS static (
            norm_id            bigint    NULL,
            label_data         jsonb     NULL,
            iref_after_queries jsonb     NULL,
            iref_spec_queries  jsonb     NULL,
            size               norm_size NULL,
            updated_at         js_date   NULL,
            PRIMARY KEY (norm_id, updatedat)
        );

      `;

      await expectFormat(input, output);
    });

    it("leaves unsupported SQL unchanged apart from trailing semicolon normalization", async () => {
      const input = "select * from users where id = 1";
      await expectFormat(input, "select * from users where id = 1;\n");
    });

    it("throws for invalid PostgreSQL syntax instead of guessing", async () => {
      await expect(format("create table broken (id integer,,)")).rejects.toThrow();
    });
  });

  describe("indentation", () => {
    it("makes the indentation equal to 4 spaces", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS history_iref_spec_cluster_mapping (
          norm_id  bigint  null,
          block_id integer null,
          query    text    null,
          id       integer null,
          at       js_date null,
          "by"     integer null
        );
      `;
      const expected = dedent`
        CREATE TABLE IF NOT EXISTS history_iref_spec_cluster_mapping (
            norm_id  bigint  NULL,
            block_id integer NULL,
            query    text    NULL,
            id       integer NULL,
            at       js_date NULL,
            "by"     integer NULL
        );

      `;
      await expectFormat(input, expected);
    });

    it("fixes indentation not only at the first line", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS shared_database (
              login        text    not null,
              shared_login text    not null,
              created_at   js_date not null DEFAULT now(),
              CONSTRAINT shared_database_un UNIQUE (login, shared_login)
            );
      `;
      const expected = dedent`
          CREATE TABLE IF NOT EXISTS shared_database (
              login        text    NOT NULL,
              shared_login text    NOT NULL,
              created_at   js_date NOT NULL DEFAULT now(),
              CONSTRAINT shared_database_un UNIQUE (login, shared_login)
          );

      `;
      await expectFormat(input, expected);
    });

    it("aligns nullable columns without extra clauses", async () => {
      const input = dedent`
        CREATE TABLE ai_request(
          login text not null,
          full_output text null,
          error text null
        )
      `;
      const expected = dedent`
        CREATE TABLE ai_request (
            login       text NOT NULL,
            full_output text     NULL,
            error       text     NULL
        );

      `;

      await expectFormat(input, expected);
    });

    it("changes indentation before not null", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS database_x_user (
          login       text    not null,
          database    text    not null,
          is_personal boolean     not null,
          CONSTRAINT database_x_user_un UNIQUE (login, database)
        );
      `;

      const expected = dedent`
        CREATE TABLE IF NOT EXISTS database_x_user (
            login       text    NOT NULL,
            database    text    NOT NULL,
            is_personal boolean NOT NULL,
            CONSTRAINT database_x_user_un UNIQUE (login, database)
        );

      `;
      await expectFormat(input, expected);
    });

    it("always puts 'null' or 'not null'", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS actual_assignee (
            norm_id bigint,
            value integer,
            at js_date NOT NULL,
            "by" integer,
            CONSTRAINT actual_assignee_pkey PRIMARY KEY (norm_id)
        );
      `;
      const expected = dedent`
        CREATE TABLE IF NOT EXISTS actual_assignee (
            norm_id bigint      NULL,
            value   integer     NULL,
            at      js_date NOT NULL,
            "by"    integer     NULL,
            CONSTRAINT actual_assignee_pkey PRIMARY KEY (norm_id)
        );

      `;
      await expectFormat(input, expected);
    });
  });

  describe("syntax", () => {
    it("puts 'not null' before anything else", async () => {
      const input = dedent`
        CREATE TABLE abc (
          a int DEFAULT 10 not null,
          b int DEFAULT 10     null
        );
      `;
      const expected = dedent`
        CREATE TABLE abc (
            a int NOT NULL DEFAULT 10,
            b int     NULL DEFAULT 10
        );

      `;
      await expectFormat(input, expected);
    });

    it("preserves inline comments above columns", async () => {
      const input = dedent`
        CREATE TABLE job(
          job_id integer generated always as identity,
          -- important note
          created_at timestamp not null
        )
      `;
      const expected = dedent`
        CREATE TABLE job (
            job_id     integer   GENERATED ALWAYS AS IDENTITY,
            -- important note
            created_at timestamp NOT NULL
        );

      `;

      await expectFormat(input, expected);
    });

    it("preserves quoted identifiers in supported tables", async () => {
      const input = dedent`
        CREATE TABLE database(
          "table" varchar(50) not null,
          database varchar(50) not null
        )
      `;
      const expected = dedent`
        CREATE TABLE database (
            "table"  varchar(50) NOT NULL,
            database varchar(50) NOT NULL
        );

      `;

      await expectFormat(input, expected);
    });
  });

  describe("casing", () => {
    it("uppercases partition clauses and foreign key keywords", async () => {
      const input = dedent`
        create table job(
          status_id integer not null,
          constraint status_fk foreign key(status_id) references dict_job_status(id)
        ) partition by range(created_at)
      `;
      const expected = dedent`
        CREATE TABLE job (
            status_id integer NOT NULL,
            CONSTRAINT status_fk FOREIGN KEY (status_id) REFERENCES dict_job_status (id)
        ) PARTITION BY RANGE (created_at);

      `;

      await expectFormat(input, expected);
    });

    it("keeps DEFAULT clauses attached to the nullability column", async () => {
      const input = dedent`
        CREATE TABLE shared_database (
          login text not null,
          created_at js_date not null DEFAULT now(),
          is_active boolean not null DEFAULT true
        )
      `;
      const expected = dedent`
        CREATE TABLE shared_database (
            login      text    NOT NULL,
            created_at js_date NOT NULL DEFAULT now(),
            is_active  boolean NOT NULL DEFAULT true
        );

      `;

      await expectFormat(input, expected);
    });

    it("changes uppercases 'default'", async () => {
      const input = dedent`
        CREATE TABLE IF NOT EXISTS shared_database (
            created_at   js_date not null default now(),
            CONSTRAINT shared_database_un UNIQUE (login, shared_login)
        );
      `;
      const expected = dedent`
        CREATE TABLE IF NOT EXISTS shared_database (
            created_at js_date NOT NULL DEFAULT now(),
            CONSTRAINT shared_database_un UNIQUE (login, shared_login)
        );

      `;

      await expectFormat(input, expected);
    });
  });
});
