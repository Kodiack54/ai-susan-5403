/**
 * Susan Chat Routes
 * Direct conversation with Susan
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { chat } = require('../lib/openai');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Chat');

/**
 * POST /api/chat - Chat with Susan
 */
router.post('/chat', async (req, res) => {
  const { message, context, projectPath } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Build context from database
    const chatContext = await buildChatContext(projectPath);

    const reply = await chat(message, {
      ...chatContext,
      additionalContext: context
    });

    logger.info('Chat response', {
      messagePreview: message.slice(0, 50),
      replyPreview: reply.slice(0, 50)
    });

    res.json({
      success: true,
      reply,
      from: 'susan'
    });
  } catch (err) {
    logger.error('Chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Build context for chat from database
 */
async function buildChatContext(projectPath) {
  // Get knowledge base
  let knowledgeQuery = from('dev_ai_knowledge')
    .select('category, title, summary')
    .order('importance', { ascending: false })
    .limit(10);

  if (projectPath) {
    knowledgeQuery = knowledgeQuery.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  const { data: knowledge } = await knowledgeQuery;

  // Get recent decisions
  let decisionsQuery = from('dev_ai_decisions')
    .select('title, decision, rationale')
    .order('created_at', { ascending: false })
    .limit(5);

  if (projectPath) {
    decisionsQuery = decisionsQuery.eq('project_path', projectPath);
  }

  const { data: decisions } = await decisionsQuery;

  // Get schemas
  const { data: schemas } = await from('dev_ai_schemas')
    .select('database_name, table_name, description')
    .limit(20);

  // Build context strings
  const knowledgeContext = knowledge?.length > 0
    ? `Knowledge I've cataloged:\n${knowledge.map(k =>
        `- [${k.category}] ${k.title}: ${k.summary?.slice(0, 100) || ''}`
      ).join('\n')}`
    : 'No knowledge cataloged yet.';

  const decisionContext = decisions?.length > 0
    ? `Recent decisions:\n${decisions.map(d =>
        `- ${d.title}: ${d.decision}`
      ).join('\n')}`
    : '';

  const schemaContext = schemas?.length > 0
    ? `Database tables I know about:\n${schemas.map(s =>
        `- ${s.database_name}.${s.table_name}: ${s.description || 'No description'}`
      ).join('\n')}`
    : '';

  return {
    knowledgeContext,
    decisionContext,
    schemaContext
  };
}

module.exports = router;
