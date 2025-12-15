-- Susan Database Migration 002
-- Purge requests and conflict detection tables
-- IMPORTANT: Susan can flag items but NEVER deletes without dev approval

-- ============================================
-- Purge Requests Table
-- Susan flags stale/orphan data here, dev must approve to delete
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_purge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_count INTEGER DEFAULT 0,
  record_ids UUID[] DEFAULT '{}',
  cutoff_date TIMESTAMPTZ,
  reason TEXT,
  project_id TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  flagged_by TEXT DEFAULT 'susan',
  reviewed_by TEXT,  -- Dev who approved/rejected
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purge_requests_status ON dev_ai_purge_requests(status);
CREATE INDEX IF NOT EXISTS idx_purge_requests_project ON dev_ai_purge_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_purge_requests_created ON dev_ai_purge_requests(created_at);

-- ============================================
-- Conflicts Table
-- When Susan finds info that contradicts existing knowledge, flag it
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_path TEXT,

  -- The existing record
  existing_table TEXT NOT NULL,
  existing_id UUID NOT NULL,
  existing_content TEXT,
  existing_summary TEXT,

  -- The new conflicting info
  new_content TEXT NOT NULL,
  new_source TEXT,  -- Where the new info came from (session, file, etc.)

  -- Conflict details
  conflict_type TEXT DEFAULT 'contradiction',  -- 'contradiction', 'outdated', 'duplicate', 'ambiguous'
  conflict_description TEXT,  -- Susan's explanation of the conflict

  -- Resolution
  status TEXT DEFAULT 'pending',  -- 'pending', 'resolved_keep_existing', 'resolved_update', 'resolved_both_valid'
  resolution_notes TEXT,
  resolved_by TEXT,  -- Dev who resolved
  resolved_at TIMESTAMPTZ,

  -- Metadata
  flagged_by TEXT DEFAULT 'susan',
  priority TEXT DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_status ON dev_ai_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_project ON dev_ai_conflicts(project_path);
CREATE INDEX IF NOT EXISTS idx_conflicts_priority ON dev_ai_conflicts(priority);
CREATE INDEX IF NOT EXISTS idx_conflicts_type ON dev_ai_conflicts(conflict_type);

-- ============================================
-- Dev Notifications Table
-- Susan can send notifications to assigned devs
-- ============================================
CREATE TABLE IF NOT EXISTS dev_ai_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_id TEXT NOT NULL,  -- Who should receive this
  project_path TEXT,

  notification_type TEXT NOT NULL,  -- 'conflict', 'purge_request', 'todo', 'alert'
  title TEXT NOT NULL,
  message TEXT,

  -- Link to related record
  related_table TEXT,
  related_id UUID,

  -- Status
  status TEXT DEFAULT 'unread',  -- 'unread', 'read', 'dismissed'
  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_dev ON dev_ai_notifications(dev_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON dev_ai_notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON dev_ai_notifications(notification_type);

-- ============================================
-- Triggers for timestamp updates
-- ============================================
DROP TRIGGER IF EXISTS update_dev_ai_conflicts_updated_at ON dev_ai_conflicts;
