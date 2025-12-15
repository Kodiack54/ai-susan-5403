/**
 * Susan Decisions Routes
 * Track architectural decisions
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Decisions');

/**
 * POST /api/decision - Record architecture decision
 */
router.post('/decision', async (req, res) => {
  const { sessionId, title, context, decision, alternatives, rationale, projectPath, tags } = req.body;

  if (!title || !decision) {
    return res.status(400).json({ error: 'Title and decision required' });
  }

  try {
    const { data, error } = await from('dev_ai_decisions')
      .insert({
        session_id: sessionId,
        title,
        context,
        decision,
        alternatives: alternatives || [],
        rationale,
        project_path: projectPath,
        tags: tags || []
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Decision recorded', { id: data.id, title });
    res.json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Decision record failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/decisions - Get decisions
 */
router.get('/decisions', async (req, res) => {
  const { project, limit = 20 } = req.query;

  try {
    let query = from('dev_ai_decisions')
      .select('id, title, context, decision, alternatives, rationale, project_path, tags, created_at')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (project) {
      query = query.eq('project_path', project);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    logger.error('Decisions fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/decision/:id - Get specific decision
 */
router.get('/decision/:id', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_decisions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/decision/:id - Delete decision
 */
router.delete('/decision/:id', async (req, res) => {
  try {
    const { error } = await from('dev_ai_decisions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    logger.info('Decision deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
