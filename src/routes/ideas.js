/**
 * Susan Ideas Routes
 * Link brainstorm ideas to projects when they're created
 */

const express = require('express');
const router = express.Router();
const { Logger } = require('../lib/logger');
const ideaLinker = require('../services/ideaLinker');

const logger = new Logger('Susan:Ideas');

/**
 * POST /api/ideas/link-all - Link all matching ideas to projects
 */
router.post('/link-all', async (req, res) => {
  try {
    logger.info('Running idea-to-project linker');
    const result = await ideaLinker.linkIdeasToNewProjects();

    logger.info('Linker complete', result);
    res.json(result);
  } catch (err) {
    logger.error('Link-all failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ideas/link - Link a specific idea to a project
 * Body: { ideaTitle: string, projectName: string, promote?: boolean }
 */
router.post('/link', async (req, res) => {
  const { ideaTitle, projectName, promote = true } = req.body;

  if (!ideaTitle || !projectName) {
    return res.status(400).json({ error: 'ideaTitle and projectName required' });
  }

  try {
    logger.info('Linking idea to project', { ideaTitle, projectName });
    const result = await ideaLinker.linkIdeaByName(ideaTitle, projectName, promote);

    if (result.success) {
      logger.info('Idea linked successfully', result);
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    logger.error('Link failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ideas/unlinked - Get all unlinked ideas
 */
router.get('/unlinked', async (req, res) => {
  try {
    const ideas = await ideaLinker.getUnlinkedIdeas();
    res.json(ideas);
  } catch (err) {
    logger.error('Get unlinked failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ideas/match/:projectName - Find ideas that match a project
 */
router.get('/match/:projectName', async (req, res) => {
  const { projectName } = req.params;

  try {
    // Create mock project object for matching
    const project = { name: projectName, slug: projectName.toLowerCase().replace(/\s+/g, '-') };
    const matches = await ideaLinker.findMatchingIdeas(project);

    res.json(matches.map(m => ({
      title: m.idea.title,
      summary: m.idea.summary,
      score: m.score,
      id: m.idea.id
    })));
  } catch (err) {
    logger.error('Match failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
