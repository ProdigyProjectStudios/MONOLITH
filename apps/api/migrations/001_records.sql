CREATE TABLE IF NOT EXISTS records (
 tenant varchar NOT NULL, kind varchar NOT NULL, id varchar NOT NULL,
 payload text NOT NULL, PRIMARY KEY (tenant,kind,id)
);
CREATE TABLE IF NOT EXISTS audit (
 id serial PRIMARY KEY, tenant varchar NOT NULL, action varchar NOT NULL,
 detail text NOT NULL, at varchar NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_tenant ON audit (tenant);
