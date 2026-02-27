-- Add new summary stats columns to cached_analyses
ALTER TABLE cached_analyses ADD COLUMN IF NOT EXISTS under_100k integer DEFAULT 0;
ALTER TABLE cached_analyses ADD COLUMN IF NOT EXISTS avg_yield numeric(4,1) DEFAULT NULL;
ALTER TABLE cached_analyses ADD COLUMN IF NOT EXISTS dev_potential integer DEFAULT 0;
ALTER TABLE cached_analyses ADD COLUMN IF NOT EXISTS vacant_count integer DEFAULT 0;
