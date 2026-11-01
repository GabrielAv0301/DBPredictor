PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_assets (
  asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  asset_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stage_receipts (
  receipt_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hvs_creator_assets (
  asset_id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  asset_name TEXT NOT NULL,
  app_category TEXT NOT NULL,
  app_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  r2_object_key TEXT UNIQUE,
  local_path_blueprint TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  tags_json TEXT NOT NULL DEFAULT '[]',
  embedding_json TEXT NOT NULL DEFAULT '[]',
  quality_score REAL NOT NULL DEFAULT 0,
  owner TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY,
  verb TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  operator TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  consent_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lineage (
  event_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_state (
  asset_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  last_error TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_reports (
  report_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  quality_score REAL NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS duplicate_groups (
  group_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS embeddings (
  embedding_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'local-audio-rag',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voice_dna_catalog (
  voice_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  embedding_ref TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_assets_sha256 ON local_assets (sha256);
CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets (owner);
CREATE INDEX IF NOT EXISTS idx_lineage_asset_id ON lineage (asset_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_asset_id ON embeddings (asset_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_agent_id ON work_orders (agent_id);
