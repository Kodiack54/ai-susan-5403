/**
 * Susan Knowledge Routes
 * Query, remember, and manage knowledge base
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Knowledge');

/**
 * GET /api/query - Search knowledge base
 */
router.get('/query', async (req, res) => {
  const { q, project, category, limit = 10 } = req.query;

  try {
    let query = from('dev_ai_knowledge')
      .select('id, category, title, summary, tags, importance, created_at')
      .order('importance', { ascending: false })
      .limit(parseInt(limit));

    if (q) {
      query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
    }

    if (project) {
      query = query.eq('project_path', project);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw error;

    logger.info('Knowledge query', {
      query: q,
      project,
      resultCount: data?.length || 0
    });

    res.json(data || []);
  } catch (err) {
    logger.error('Query failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/remember - Manually add knowledge
 */
router.post('/remember', async (req, res) => {
  const { category, title, summary, details, tags, projectPath, importance } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title required' });
  }

  try {
    const { data, error } = await from('dev_ai_knowledge')
      .insert({
        category: category || 'note',
        title,
        summary,
        details,
        tags: tags || [],
        project_path: projectPath,
        importance: importance || 5
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Knowledge remembered', { id: data.id, title });
    res.json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Remember failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/knowledge/:id - Get specific knowledge item
 */
router.get('/knowledge/:id', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_knowledge')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/knowledge/:id - Delete knowledge item
 */
router.delete('/knowledge/:id', async (req, res) => {
  try {
    const { error } = await from('dev_ai_knowledge')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    logger.info('Knowledge deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/categories - Get all knowledge categories
 */
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_knowledge')
      .select('category')
      .order('category');

    if (error) throw error;

    const categories = [...new Set(data.map(d => d.category))];
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
