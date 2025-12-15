-- Susan Database Migration 001
-- New tables for documentation, todos, and file structures

-- ============================================
-- Documentation Table
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_path TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'general',  -- 'readme', 'api', 'architecture', 'setup', 'general'
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint to prevent duplicate docs
  UNIQUE(project_path, doc_type, title)
);

CREATE INDEX IF NOT EXISTS idx_dev_ai_docs_project ON dev_ai_docs(project_path);
CREATE INDEX IF NOT EXISTS idx_dev_ai_docs_type ON dev_ai_docs(doc_type);

-- ============================================
-- Todos Table
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_path TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
  category TEXT DEFAULT 'general',  -- 'bug', 'feature', 'refactor', 'docs', 'test', 'general'
  status TEXT DEFAULT 'pending',    -- 'pending', 'in_progress', 'completed', 'cancelled'
  discovered_in TEXT,  -- Where this todo was discovered (session ID, file, etc.)
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dev_ai_todos_project ON dev_ai_todos(project_path);
CREATE INDEX IF NOT EXISTS idx_dev_ai_todos_status ON dev_ai_todos(status);
CREATE INDEX IF NOT EXISTS idx_dev_ai_todos_priority ON dev_ai_todos(priority);

-- ============================================
-- File Structures Table
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_path TEXT NOT NULL UNIQUE,
  structure JSONB DEFAULT '{}',  -- Full file structure as JSON
  description TEXT,
  ports JSONB DEFAULT '[]',      -- Array of {port, service, description}
  services JSONB DEFAULT '[]',   -- Array of {name, type, path, port, description}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_ai_structures_project ON dev_ai_structures(project_path);

-- ============================================
-- Add source and cataloger columns to knowledge table
-- ============================================
ALTER TABLE dev_ai_knowledge
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'extraction',
  ADD COLUMN IF NOT EXISTS cataloger TEXT;

-- ============================================
-- Enable Row Level Security (optional, uncomment if needed)
-- ============================================
-- ALTER TABLE dev_ai_docs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE dev_ai_todos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE dev_ai_structures ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Trigger for updated_at timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dev_ai_docs_updated_at ON dev_ai_docs;
CREATE TRIGGER update_dev_ai_docs_updated_at
  BEFORE UPDATE ON dev_ai_docs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_dev_ai_todos_updated_at ON dev_ai_todos;
CREATE TRIGGER update_dev_ai_todos_updated_at
  BEFORE UPDATE ON dev_ai_todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_dev_ai_structures_updated_at ON dev_ai_structures;
CREATE TRIGGER update_dev_ai_structures_updated_at
  BEFORE UPDATE ON dev_ai_structures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
