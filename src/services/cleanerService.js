/**
 * Susan Cleaner Service - Simplified
 * Cleans up old/duplicate data
 */

const { from } = require('../../../shared/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Cleaner');

let isRunning = false;

// Retention periods in days
const RETENTION = {
  empty_sessions: 1,
  completed_sessions: 30,
  duplicate_threshold: 7
};

/**
 * Start the cleaner service
 */
function start(intervalMs = 30 * 60 * 1000) {
  logger.info('Cleaner service started', { intervalMs });
  
  // Run immediately then on interval
  setTimeout(runCycle, 5000);
  setInterval(runCycle, intervalMs);
}

/**
 * Run a cleanup cycle
 */
async function runCycle() {
  if (isRunning) {
    logger.info('Cleaner already running, skipping');
    return;
  }

  isRunning = true;
  const stats = { emptySessions: 0, duplicates: 0 };

  try {
    stats.emptySessions = await cleanEmptySessions();
    stats.duplicates = await cleanDuplicateKnowledge();
    
    if (stats.emptySessions > 0 || stats.duplicates > 0) {
      logger.info('Cleaner cycle complete', stats);
    }
  } catch (err) {
    logger.error('Cleaner cycle failed', { error: err.message });
  } finally {
    isRunning = false;
  }

  return stats;
}

/**
 * Remove sessions that have been active too long without processing
 */
async function cleanEmptySessions() {
  try {
    const cutoff = new Date(Date.now() - RETENTION.empty_sessions * 24 * 60 * 60 * 1000).toISOString();

    // Find old active sessions
    const { data: oldSessions, error } = await from('dev_ai_sessions')
      .select('id')
      .eq('status', 'active')
      .lt('started_at', cutoff);

    if (error || !oldSessions?.length) return 0;

    // Mark them as stale instead of deleting
    for (const session of oldSessions) {
      await from('dev_ai_sessions')
        .update({ status: 'stale' })
        .eq('id', session.id);
    }

    if (oldSessions.length > 0) {
      logger.info('Marked stale sessions', { count: oldSessions.length });
    }

    return oldSessions.length;
  } catch (err) {
    logger.error('cleanEmptySessions failed', { error: err.message });
    return 0;
  }
}

/**
 * Remove duplicate knowledge entries (same title + project_id)
 */
async function cleanDuplicateKnowledge() {
  try {
    const { data: knowledge } = await from('dev_ai_knowledge')
      .select('id, title, project_id, created_at')
      .order('created_at', { ascending: true });

    if (!knowledge?.length) return 0;

    const seen = new Map();
    const duplicateIds = [];

    for (const k of knowledge) {
      const key = (k.project_id || 'global') + ':' + (k.title || '').toLowerCase();
      if (seen.has(key)) {
        duplicateIds.push(k.id);
      } else {
        seen.set(key, k.id);
      }
    }

    if (duplicateIds.length > 0) {
      // Delete duplicates in batches
      for (let i = 0; i < duplicateIds.length; i += 50) {
        const batch = duplicateIds.slice(i, i + 50);
        await from('dev_ai_knowledge').delete().in('id', batch);
      }
      logger.info('Removed duplicate knowledge', { count: duplicateIds.length });
    }

    return duplicateIds.length;
  } catch (err) {
    logger.error('cleanDuplicateKnowledge failed', { error: err.message });
    return 0;
  }
}

/**
 * Get cleaner stats
 */
async function getStats() {
  try {
    const { count: sessions } = await from('dev_ai_sessions')
      .select('id', { count: 'exact', head: true });
    
    const { count: knowledge } = await from('dev_ai_knowledge')
      .select('id', { count: 'exact', head: true });

    return {
      sessions: sessions || 0,
      knowledge: knowledge || 0
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  start,
  runCycle,
  getStats
};
