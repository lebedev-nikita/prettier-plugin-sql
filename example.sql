CREATE DOMAIN js_date AS timestamptz(3);

CREATE TYPE ai_request_type AS ENUM (
    'text',
    'code'
);

CREATE TABLE IF NOT EXISTS ai_request (
    login       text            not null,
    input       text            not null,
    model       text            not null,
    type        ai_request_type not null,
    full_output text                null,
    error       text                null,
    created_at  js_date         not null default now()
);

CREATE TABLE IF NOT EXISTS database (
    database   varchar(50) not null,
    comment    text            null,
    columns    jsonb       not null,
    updated_at js_date     not null,
    "table"    varchar(50) not null,
    is_active  boolean     not null default true,
    created_at js_date     not null,
    CONSTRAINT database_pkey PRIMARY KEY (database, "table")
);

CREATE TABLE IF NOT EXISTS database_x_user (
    login       text    not null,
    database    text    not null,
    is_personal boolean not null,
    CONSTRAINT database_x_user_un UNIQUE (login, database)
);

CREATE TABLE IF NOT EXISTS dict_job_status (
    id           integer not null,
    name         text    not null,
    display_name text    not null,
    comment      text        null,
    CONSTRAINT job_status_pk PRIMARY KEY (id),
    CONSTRAINT job_status_un UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS job (
    job_id            integer   generated always as identity,
    progress          real      not null,
    status_id         integer   not null,
    -- NOTE: нельзя сделать его js_date, потому что это ключ партицирования
    -- (или можно, но это не просто)
    created_at        timestamp not null,
    -- NOTE: не превращаем в js_date просто за компанию created_at
    modified_at       timestamp not null,
    is_active         boolean   not null default true,
    sql               text          null,
    error             text          null,
    result            bytea         null,
    login             text      not null,
    parsed_result     jsonb         null,
    result_name       text          null,
    has_result_report boolean   not null default true,
    hadoop_id         text          null,
    is_abridged       boolean   not null default false,
    CONSTRAINT status_fk FOREIGN KEY (status_id) REFERENCES dict_job_status (id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS shared_database (
    login        text    not null,
    shared_login text    not null,
    created_at   js_date not null default now(),
    CONSTRAINT shared_database_un UNIQUE (login, shared_login)
);
