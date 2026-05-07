CREATE DOMAIN js_date AS timestamptz(3);

CREATE TYPE ai_request_type AS ENUM (
    'text',
    'code'
);

CREATE TABLE IF NOT EXISTS ai_request (
    login       text            NOT NULL,
    input       text            NOT NULL,
    model       text            NOT NULL,
    type        ai_request_type NOT NULL,
    full_output text                NULL,
    error       text                NULL,
    created_at  js_date         NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS database (
    database   varchar(50) NOT NULL,
    comment    text            NULL,
    columns    jsonb       NOT NULL,
    updated_at js_date     NOT NULL,
    "table"    varchar(50) NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at js_date     NOT NULL,
    CONSTRAINT database_pkey PRIMARY KEY (database, "table")
);

CREATE TABLE IF NOT EXISTS database_x_user (
    login       text    NOT NULL,
    database    text    NOT NULL,
    is_personal boolean NOT NULL,
    CONSTRAINT database_x_user_un UNIQUE (login, database)
);

CREATE TABLE IF NOT EXISTS dict_job_status (
    id           integer NOT NULL,
    name         text    NOT NULL,
    display_name text    NOT NULL,
    comment      text        NULL,
    CONSTRAINT job_status_pk PRIMARY KEY (id),
    CONSTRAINT job_status_un UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS job (
    job_id            integer   GENERATED ALWAYS AS IDENTITY,
    progress          real      NOT NULL,
    status_id         integer   NOT NULL,
    -- NOTE: нельзя сделать его js_date, потому что это ключ партицирования
    -- (или можно, но это не просто)
    created_at        timestamp NOT NULL,
    -- NOTE: не превращаем в js_date просто за компанию created_at
    modified_at       timestamp NOT NULL,
    is_active         boolean   NOT NULL DEFAULT true,
    sql               text          NULL,
    error             text          NULL,
    result            bytea         NULL,
    login             text      NOT NULL,
    parsed_result     jsonb         NULL,
    result_name       text          NULL,
    has_result_report boolean   NOT NULL DEFAULT true,
    hadoop_id         text          NULL,
    is_abridged       boolean   NOT NULL DEFAULT false,
    CONSTRAINT status_fk FOREIGN KEY (status_id) REFERENCES dict_job_status (id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS shared_database (
    login        text    NOT NULL,
    shared_login text    NOT NULL,
    created_at   js_date NOT NULL DEFAULT now(),
    CONSTRAINT shared_database_un UNIQUE (login, shared_login)
);
