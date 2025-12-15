/**
 * Susan Documentation Routes
 * Manage project documentation
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Docs');

/**
 * POST /api/docs - Create/update documentation
 */
router.post('/docs', async (req, res) => {
  const { projectPath, docType, title, content, tags } = req.body;

  if (!projectPath || !docType || !title) {
    return res.status(400).json({ error: 'projectPath, docType, and title required' });
  }

  try {
    const { data, error } = await from('dev_ai_docs')
      .upsert({
        project_path: projectPath,
        doc_type: docType,
        title,
        content,
        tags: tags || [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_path,doc_type,title'
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Documentation updated', { projectPath, docType, title });
    res.json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Doc update failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/docs - Get documentation for a project
 */
router.get('/docs', async (req, res) => {
  const { project, docType } = req.query;

  try {
    let query = from('dev_ai_docs')
      .select('id, project_path, doc_type, title, content, tags, updated_at')
      .order('updated_at', { ascending: false });

    if (project) {
      query = query.eq('project_path', project);
    }

    if (docType) {
      query = query.eq('doc_type', docType);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    logger.error('Docs fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/docs/:id - Get specific documentation
 */
router.get('/docs/:id', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_docs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) {
      return res.status(404).json({ error: 'Documentation not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/docs/:id - Delete documentation
 */
router.delete('/docs/:id', async (req, res) => {
  try {
    const { error } = await from('dev_ai_docs')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    logger.info('Documentation deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
