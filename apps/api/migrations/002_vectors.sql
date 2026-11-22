CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS document_vectors (
 tenant varchar NOT NULL, evidence_id varchar NOT NULL, model varchar NOT NULL,
 embedding vector(1536) NOT NULL, PRIMARY KEY(tenant,evidence_id,model)
);
