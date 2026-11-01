CREATE TABLE IF NOT EXISTS hvs_creator_assets (
  asset_id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  asset_name TEXT NOT NULL,
  app_category TEXT NOT NULL, -- e.g., 'Apple Creator Studio', 'Home Automation', 'Utilities'
  app_name TEXT NOT NULL, -- e.g., 'Final Cut Pro', 'Logic Pro', 'Numbers'
  file_type TEXT NOT NULL, -- e.g., '.fcpbundle', '.logicx', '.numbers'
  r2_object_key TEXT UNIQUE, -- Linked if backed up to Cloudflare R2
  local_path_blueprint TEXT, -- Local file system reference path for indexing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_asset_public_id ON hvs_creator_assets (public_id);
CREATE INDEX IF NOT EXISTS idx_asset_app ON hvs_creator_assets (app_name);
CREATE INDEX IF NOT EXISTS idx_asset_file_type ON hvs_creator_assets (file_type);

CREATE TABLE IF NOT EXISTS hvs_creator_asset_integrity (
  public_id TEXT PRIMARY KEY,
  content_sha256 TEXT,
  size_bytes INTEGER,
  last_sync_status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(public_id) REFERENCES hvs_creator_assets(public_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_integrity_sha256 ON hvs_creator_asset_integrity (content_sha256);

CREATE TRIGGER IF NOT EXISTS trg_hvs_creator_assets_updated_at
AFTER UPDATE ON hvs_creator_assets
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE hvs_creator_assets
  SET updated_at = CURRENT_TIMESTAMP
  WHERE asset_id = NEW.asset_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_hvs_creator_asset_integrity_updated_at
AFTER UPDATE ON hvs_creator_asset_integrity
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE hvs_creator_asset_integrity
  SET updated_at = CURRENT_TIMESTAMP
  WHERE public_id = NEW.public_id;
END;
