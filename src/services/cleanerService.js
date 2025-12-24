/**
 * Susan Cleaner Service
 * Background job that runs every 30 minutes to:
 * - Archive old session logs
 * - Clean up stale data
 * - Flag garbage for removal
 */

const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Cleaner');

// Cleanup interval (30 minutes)
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

// Data retention rules (in days)
const RETENTION = {
  completed_sessions: 30,     // Keep completed sessions for 30 days
  messages_in_active: 7,      // Keep messages in active sessions for 7 days
  messages_in_completed: 14,  // Keep messages in completed sessions for 14 days
  activity_data: 7,           // Quick parse activity data
  empty_sessions: 1,          // Sessions with no messages
  duplicate_knowledge: 0      // Remove immediately
};

let isRunning = false;

/**
 * Start the cleaner background job
 */
function start() {
  logger.info('Cleaner service started', { intervalMs: CLEANUP_INTERVAL_MS });

  // Run after 1 minute, then every 30 minutes
  setTimeout(() => runCleanup(), 60000);
  setInterval(() => runCleanup(), CLEANUP_INTERVAL_MS);
}

/**
 * Run a cleanup cycle
 */
async function runCleanup() {
  if (isRunning) {
    logger.warn('Cleanup already running, skipping');
    return;
  }

  isRunning = true;
  logger.info('Starting cleanup cycle');

  const stats = {
    emptySessionsRemoved: 0,
    oldMessagesArchived: 0,
    duplicatesRemoved: 0,
    duplicateTodosRemoved: 0,
    activityCleaned: 0
  };

  try {
    // 1. Remove empty sessions (no messages after 24 hours)
    stats.emptySessionsRemoved = await cleanEmptySessions();

    // 2. Archive old messages from completed sessions
    stats.oldMessagesArchived = await archiveOldMessages();

    // 3. Remove duplicate knowledge entries
    stats.duplicatesRemoved = await cleanDuplicateKnowledge();
    stats.duplicateTodosRemoved = await cleanDuplicateTodos();

    // 3b. Clean duplicates from ALL tables
    stats.allDuplicatesRemoved = await cleanAllDuplicates();

    // 4. Clean old activity data
    stats.activityCleaned = await cleanActivityData();

    logger.info('Cleanup cycle complete', stats);
  } catch (err) {
    logger.error('Cleanup cycle failed', { error: err.message });
  } finally {
    isRunning = false;
  }

  return stats;
}

/**
 * Remove sessions that have no messages after 24 hours
 */
async function cleanEmptySessions() {
  try {
    const cutoff = new Date(Date.now() - RETENTION.empty_sessions * 24 * 60 * 60 * 1000).toISOString();

    // Find empty sessions
    const { data: emptySessions, error: findError } = await from('dev_ai_sessions')
      .select('id')
      .eq('status', 'active')
      .lt('started_at', cutoff);

    if (findError || !emptySessions?.length) return 0;

    let removed = 0;
    for (const session of emptySessions) {
      // Check if session has any messages
      const { count } = await from('dev_ai_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', session.id);

      if (count === 0) {
        // No messages - delete the empty session
        await from('dev_ai_sessions').delete().eq('id', session.id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('Removed empty sessions', { count: removed });
    }

    return removed;
  } catch (err) {
    logger.error('cleanEmptySessions failed', { error: err.message });
    return 0;
  }
}

/**
 * Archive old messages from completed sessions
 */
async function archiveOldMessages() {
  try {
    const cutoff = new Date(Date.now() - RETENTION.messages_in_completed * 24 * 60 * 60 * 1000).toISOString();

    // Get old messages from completed sessions
    const { data: oldMessages, error } = await from('dev_ai_messages')
      .select('id, session_id, content')
      .lt('created_at', cutoff)
      .limit(100);

    if (error || !oldMessages?.length) return 0;

    // Check which sessions are completed
    const sessionIds = [...new Set(oldMessages.map(m => m.session_id))];
    const { data: sessions } = await from('dev_ai_sessions')
      .select('id, status')
      .in('id', sessionIds);

    const completedSessionIds = sessions?.filter(s => s.status === 'completed').map(s => s.id) || [];

    if (completedSessionIds.length === 0) return 0;

    // Archive messages from completed sessions (just delete for now - could move to archive table)
    const messagesToArchive = oldMessages.filter(m => completedSessionIds.includes(m.session_id));

    if (messagesToArchive.length > 0) {
      await from('dev_ai_messages')
        .delete()
        .in('id', messagesToArchive.map(m => m.id));

      logger.info('Archived old messages', { count: messagesToArchive.length });
    }

    return messagesToArchive.length;
  } catch (err) {
    logger.error('archiveOldMessages failed', { error: err.message });
    return 0;
  }
}

/**
 * Remove duplicate knowledge entries
 */
async function cleanDuplicateKnowledge() {
  try {
    // Find duplicate titles within same project
    const { data: knowledge } = await from('dev_ai_knowledge')
      .select('id, title, project_path, created_at')
      .order('created_at', { ascending: true });

    if (!knowledge?.length) return 0;

    const seen = new Map();
    const duplicates = [];

    for (const k of knowledge) {
      const key = `${k.project_path}:${k.title.toLowerCase()}`;
      if (seen.has(key)) {
        // This is a duplicate - mark older one for removal
        duplicates.push(seen.get(key).id);
      }
      seen.set(key, k);
    }

    if (duplicates.length > 0) {
      await from('dev_ai_knowledge')
        .delete()
        .in('id', duplicates);

      logger.info('Removed duplicate knowledge', { count: duplicates.length });
    }

    return duplicates.length;
  } catch (err) {
    logger.error('cleanDuplicateKnowledge failed', { error: err.message });
    return 0;
  }
}

/**
 * Clean old activity data
 */

  /**
   * Remove duplicate todo entries (same title + project)
   */
  async function cleanDuplicateTodos() {
    try {
      const { data: todos } = await from('dev_ai_todos')
        .select('id, title, project_path, created_at')
        .order('created_at', { ascending: true });

      if (!todos?.length) return 0;

      const seen = new Map();
      const duplicates = [];

      for (const t of todos) {
        const key = t.project_path + ':' + (t.title || '').toLowerCase();
        if (seen.has(key)) {
          duplicates.push(seen.get(key).id);
        }
        seen.set(key, t);
      }

      if (duplicates.length > 0) {
        await from('dev_ai_todos').delete().in('id', duplicates);
        logger.info('Removed duplicate todos', { count: duplicates.length });
      }

      return duplicates.length;
    } catch (err) {
      logger.error('cleanDuplicateTodos failed', { error: err.message });
      return 0;
    }
  }

  async function cleanActivityData() {
  try {
    const cutoff = new Date(Date.now() - RETENTION.activity_data * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await from('dev_ai_activity')
      .delete()
      .lt('created_at', cutoff)
      .select('id');

    if (error) throw error;

    const count = data?.length || 0;
    if (count > 0) {
      logger.info('Cleaned old activity data', { count });
    }

    return count;
  } catch (err) {
    logger.error('cleanActivityData failed', { error: err.message });
    return 0;
  }
}

/**
 * Get cleanup stats
 */
async function getStats() {
  try {
    const [sessions, messages, knowledge, activity] = await Promise.all([
      from('dev_ai_sessions').select('id', { count: 'exact', head: true }),
      from('dev_ai_messages').select('id', { count: 'exact', head: true }),
      from('dev_ai_knowledge').select('id', { count: 'exact', head: true }),
      from('dev_ai_activity').select('id', { count: 'exact', head: true })
    ]);

    return {
      sessions: sessions.count || 0,
      messages: messages.count || 0,
      knowledge: knowledge.count || 0,
      activity: activity.count || 0
    };
  } catch (err) {
    logger.error('getStats failed', { error: err.message });
    return null;
  }
}

module.exports = {
  start,
  runCleanup,
  getStats
};

/**
 * Clean duplicate entries from ALL extraction tables
 * Added to prevent duplicate buildup across all tables
 */
async function cleanAllDuplicates() {
  const tables = [
    { name: 'dev_ai_todos', titleCol: 'title' },
    { name: 'dev_ai_bugs', titleCol: 'title' },
    { name: 'dev_ai_journal', titleCol: 'title' },
    { name: 'dev_ai_decisions', titleCol: 'title' },
    { name: 'dev_ai_lessons', titleCol: 'title' },
    { name: 'dev_ai_conventions', titleCol: 'name' },
  ];

  let totalRemoved = 0;

  for (const table of tables) {
    try {
      const { data: rows } = await from(table.name)
        .select(`id, ${table.titleCol}, project_path, created_at`)
        .order('created_at', { ascending: true });

      if (!rows?.length) continue;

      const seen = new Map();
      const duplicates = [];

      for (const row of rows) {
        const title = row[table.titleCol] || '';
        const key = `${row.project_path}:${title.toLowerCase().substring(0, 100)}`;
        if (seen.has(key)) {
          duplicates.push(row.id);
        } else {
          seen.set(key, row);
        }
      }

      if (duplicates.length > 0) {
        await from(table.name).delete().in('id', duplicates);
        logger.info(`Removed duplicates from ${table.name}`, { count: duplicates.length });
        totalRemoved += duplicates.length;
      }
    } catch (err) {
      logger.error(`Error cleaning ${table.name}`, { error: err.message });
    }
  }

  return totalRemoved;
}
