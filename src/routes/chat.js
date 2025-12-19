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

  // Get todos
  const { data: todos } = await from('dev_ai_todos')
    .select('title, description, priority, status, project_path')
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: true })
    .limit(10);

  // Get projects
  const { data: projects } = await from('dev_projects')
    .select('name, slug, description, server_path, port_dev')
    .eq('is_active', true)
    .limit(10);

  // Get recent sessions
  const { data: sessions } = await from('dev_ai_sessions')
    .select('project_path, summary, started_at, status')
    .order('started_at', { ascending: false })
    .limit(5);

  // Get port assignments
  const { data: ports } = await from('dev_port_assignments')
    .select('port, service_name, description')
    .order('port', { ascending: true })
    .limit(20);

  // Build context strings
  const knowledgeContext = knowledge?.length > 0
    ? `Knowledge I've cataloged:\n${knowledge.map(k =>
        `- [${k.category}] ${k.title}: ${k.summary?.slice(0, 100) || ''}`
      ).join('\n')}`
    : '';

  const decisionContext = decisions?.length > 0
    ? `Recent decisions:\n${decisions.map(d =>
        `- ${d.title}: ${d.decision}`
      ).join('\n')}`
    : '';

  const schemaContext = schemas?.length > 0
    ? `Database tables:\n${schemas.map(s =>
        `- ${s.database_name}.${s.table_name}: ${s.description || 'No description'}`
      ).join('\n')}`
    : '';

  const todoContext = todos?.length > 0
    ? `Active todos:\n${todos.map(t =>
        `- [${t.priority}] ${t.title} (${t.status})`
      ).join('\n')}`
    : '';

  const projectContext = projects?.length > 0
    ? `Projects I know about:\n${projects.map(p =>
        `- ${p.name} (${p.slug}): ${p.description || 'No description'} - Port ${p.port_dev}`
      ).join('\n')}`
    : '';

  const sessionContext = sessions?.length > 0
    ? `Recent Claude sessions:\n${sessions.map(s =>
        `- ${s.project_path}: ${s.summary || 'No summary'} (${s.status})`
      ).join('\n')}`
    : '';

  const portContext = ports?.length > 0
    ? `Port assignments:\n${ports.map(p =>
        `- ${p.port}: ${p.service_name} - ${p.description || ''}`
      ).join('\n')}`
    : '';

  // Team info - always include this
  const teamContext = `
AI Team at Kodiack Studios:
- Claude: Lead Programmer - he's the one who actually writes code in the terminal
- Chad: Developer's Assistant - he watches Claude's sessions and transcribes everything
- Susan: Developer's Librarian - that's me! I organize all the knowledge and help you find things
- Dev Studio: The dashboard where you interact with us`;

  return {
    knowledgeContext: [teamContext, projectContext, sessionContext, knowledgeContext, todoContext, decisionContext, schemaContext, portContext].filter(Boolean).join('\n\n'),
    decisionContext: '',
    schemaContext: ''
  };
}

module.exports = router;

// ========================================
// REVIEW QUEUE ROUTES - Susan asks questions
// ========================================

const classifier = require('../services/knowledgeClassifier');

/**
 * GET /api/chat/pending-questions - Get questions Susan needs to ask
 */
router.get('/pending-questions', async (req, res) => {
  try {
    const reviews = await classifier.getPendingReviews(5);
    const questions = reviews.map(r => classifier.formatReviewQuestion(r));
    
    res.json({
      success: true,
      count: questions.length,
      questions
    });
  } catch (err) {
    logger.error('Failed to get pending questions', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/answer-question - User answers Susan's question
 */
router.post('/answer-question', async (req, res) => {
  const { reviewId, answer, answeredBy } = req.body;
  
  if (!reviewId || !answer) {
    return res.status(400).json({ error: 'reviewId and answer required' });
  }
  
  try {
    const result = await classifier.processReviewAnswer(reviewId, answer, answeredBy || 'user');
    
    if (result.success) {
      // Generate a thank you message
      const thankYou = result.wasCorrection
        ? `Got it! I'll remember that this is a **${answer}**, not what I thought. Thanks for teaching me!`
        : `Thanks for confirming! I was pretty sure it was a **${answer}**.`;
      
      res.json({
        success: true,
        message: thankYou,
        ...result
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logger.error('Failed to process answer', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/chat/has-questions - Quick check if Susan has questions
 */
router.get('/has-questions', async (req, res) => {
  try {
    const hasPending = await classifier.hasPendingQuestions();
    res.json({ hasQuestions: hasPending });
  } catch (err) {
    res.json({ hasQuestions: false });
  }
});

/**
 * POST /api/chat/ask - Susan proactively asks in the chat
 * Returns a formatted question if there are pending reviews
 */
router.post('/ask', async (req, res) => {
  try {
    const reviews = await classifier.getPendingReviews(1);
    
    if (reviews.length === 0) {
      return res.json({
        success: true,
        hasQuestion: false,
        message: null
      });
    }
    
    const review = reviews[0];
    const question = classifier.formatReviewQuestion(review);
    
    res.json({
      success: true,
      hasQuestion: true,
      question,
      message: `Hey! I need your help with something. ${review.question_text}`
    });
  } catch (err) {
    logger.error('Failed to get question', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
