/**
 * Team Chat API Routes for Susan
 * Provides chat history for both Dashboard and Dev Studio
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:TeamChat');
// UUID validation helper
const isValidUUID = (str) => {
  if (!str) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};


/**
 * GET /workers
 * Get list of AI workers for chat channels
 */
router.get('/workers', async (req, res) => {
  try {
    const { data, error } = await db
      .from('dev_ai_workers')
      .select('id, name, slug, role, personality, port')
      .order('name');
    
    if (error) throw error;
    res.json({ success: true, workers: data });
  } catch (error) {
    logger.error('Failed to get workers', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /pending
 * Get all pending questions from workers
 */
router.get('/pending', async (req, res) => {
  try {
    const { userId } = req.query;

    // Get all workers first
    const { data: workers } = await db.from('dev_ai_workers').select('id, slug, name');
    const workerMap = {};
    (workers || []).forEach(w => { workerMap[w.id] = w; });

    let query = db
      .from('dev_team_chat')
      .select('id, worker_id, content, created_at')
      .eq('status', 'pending')
      .eq('direction', 'from_worker')
      .order('created_at', { ascending: false });

    if (userId && isValidUUID(userId)) {
      query = query.eq('user_id', userId);
    }

    const { data: pending, error } = await query;
    if (error) throw error;

    // Group by worker
    const byWorker = {};
    (pending || []).forEach(p => {
      const worker = workerMap[p.worker_id] || { slug: 'unknown', name: 'Unknown' };
      const slug = worker.slug;
      if (!byWorker[slug]) {
        byWorker[slug] = { name: worker.name, count: 0, messages: [] };
      }
      byWorker[slug].count++;
      byWorker[slug].messages.push(p);
    });

    res.json({ success: true, pending: byWorker, total: pending?.length || 0 });
  } catch (error) {
    logger.error('Failed to get pending', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /:workerSlug/messages
 * Get chat history with a specific worker
 */
router.get('/:workerSlug/messages', async (req, res) => {
  try {
    const { workerSlug } = req.params;
    const { userId, limit = 50, before } = req.query;

    const { data: worker } = await db
      .from('dev_ai_workers')
      .select('id')
      .eq('slug', workerSlug)
      .single();

    if (!worker) {
      return res.status(404).json({ success: false, error: 'Worker not found' });
    }

    let query = db
      .from('dev_team_chat')
      .select('*')
      .eq('worker_id', worker.id)
      .is('response_to', null)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (userId && isValidUUID(userId)) {
      query = query.eq('user_id', userId);
    }

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    res.json({ success: true, messages: (messages || []).reverse() });
  } catch (error) {
    logger.error('Failed to get messages', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /:workerSlug/thread/:messageId
 * Get thread replies
 */
router.get('/:workerSlug/thread/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: messages, error } = await db
      .from('dev_team_chat')
      .select('*')
      .or('id.eq.' + messageId + ',response_to.eq.' + messageId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ success: true, messages });
  } catch (error) {
    logger.error('Failed to get thread', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /:workerSlug/send
 * Send a message to a worker
 */
router.post('/:workerSlug/send', async (req, res) => {
  try {
    const { workerSlug } = req.params;
    const { userId, projectId, content, replyTo } = req.body;

    const { data: worker } = await db
      .from('dev_ai_workers')
      .select('id')
      .eq('slug', workerSlug)
      .single();

    if (!worker) {
      return res.status(404).json({ success: false, error: 'Worker not found' });
    }

    const { data: message, error } = await db
      .from('dev_team_chat')
      .insert({
        worker_id: worker.id,
        user_id: isValidUUID(userId) ? userId : null,
        project_id: isValidUUID(projectId) ? projectId : null,
        direction: 'user_to_worker',
        message_type: replyTo ? 'answer' : 'message',
        content,
        response_to: replyTo || null,
        status: 'sent'
      })
      .select()
      .single();

    if (error) throw error;

    if (replyTo) {
      await db.from('dev_team_chat').update({ status: 'answered' }).eq('id', replyTo);
      
      // Notify Chad to process the answer for learning (fire and forget)
      if (workerSlug === 'chad') {
        try {
          const fetch = require('node-fetch');
          fetch('http://localhost:5401/api/team-chat/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questionId: replyTo, answer: content })
          }).catch(err => logger.warn('Failed to notify Chad', { error: err.message }));
        } catch (e) {
          // Don't block on Chad notification
        }
      }
    }

    logger.info('Message sent', { workerSlug, userId, replyTo: !!replyTo });
    res.json({ success: true, message });
  } catch (error) {
    logger.error('Failed to send message', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
