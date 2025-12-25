/**
 * Susan Project Data Routes
 * Returns all data for a specific project (for Project Manager tabs)
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:ProjectData');

/**
 * GET /api/project-data - Get all data for a project
 * Query: projectPath (required)
 */
router.get('/project-data', async (req, res) => {
  const { projectPath } = req.query;

  if (!projectPath) {
    return res.status(400).json({ error: 'projectPath required' });
  }

  logger.info('Fetching project data', { projectPath });

  try {
    // Fetch all data in parallel
    const [todosResult, knowledgeResult, decisionsResult, codeChangesResult, schemasResult] = await Promise.all([
      // Todos for this project
      from('dev_ai_todos')
        .select('id, title, description, priority, status, created_at, completed_at')
        .eq('project_id', projectPath)
        .order('created_at', { ascending: false })
        .limit(50),

      // Knowledge for this project
      from('dev_ai_knowledge')
        .select('id, category, title, summary, importance, created_at')
        .eq('project_id', projectPath)
        .order('importance', { ascending: false })
        .limit(50),

      // Decisions for this project
      from('dev_ai_decisions')
        .select('id, title, decision, rationale, created_at')
        .eq('project_id', projectPath)
        .order('created_at', { ascending: false })
        .limit(50),

      // Code changes for this project
      from('dev_ai_code_changes')
        .select('id, file_path, action, summary, created_at')
        .eq('project_id', projectPath)
        .order('created_at', { ascending: false })
        .limit(100),

      // Schemas (use ilike for partial match on project)
      from('dev_ai_schemas')
        .select('id, database_name, table_name, description, last_scanned')
        .order('table_name', { ascending: true })
        .limit(100)
    ]);

    res.json({
      success: true,
      projectPath,
      todos: todosResult.data || [],
      knowledge: knowledgeResult.data || [],
      decisions: decisionsResult.data || [],
      codeChanges: codeChangesResult.data || [],
      schemas: schemasResult.data || []
    });

  } catch (err) {
    logger.error('Failed to fetch project data', { error: err.message, projectPath });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
