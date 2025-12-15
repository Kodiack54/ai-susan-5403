/**
 * Susan Context Routes
 * Provides startup context to Claude
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');
const config = require('../lib/config');

const logger = new Logger('Susan:Context');

/**
 * GET /api/context - Claude's startup context
 */
router.get('/context', async (req, res) => {
  const projectPath = req.query.project || req.query.path;
  const userId = req.query.userId;

  try {
    const context = await buildStartupContext(projectPath, userId);
    res.json(context);
  } catch (err) {
    logger.error('Context build failed', { error: err.message, projectPath });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Build comprehensive startup context for Claude
 */
async function buildStartupContext(projectPath, userId) {
  const context = {
    greeting: null,
    lastSession: null,
    recentMessages: [],
    relevantKnowledge: [],
    pendingTasks: [],
    projectInfo: null
  };

  // 1. Get last session for this project
  let sessionQuery = from('dev_ai_sessions')
    .select('id, project_path, started_at, ended_at, summary')
    .eq('status', 'completed')
    .order('ended_at', { ascending: false })
    .limit(1);

  if (projectPath) {
    sessionQuery = sessionQuery.eq('project_path', projectPath);
  }
  if (userId) {
    sessionQuery = sessionQuery.eq('user_id', userId);
  }

  const { data: sessions } = await sessionQuery;

  if (sessions && sessions.length > 0) {
    const session = sessions[0];
    context.lastSession = {
      id: session.id,
      projectPath: session.project_path,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      summary: session.summary
    };

    // Get messages from last session
    const { data: messages } = await from('dev_ai_messages')
      .select('role, content, created_at')
      .eq('session_id', session.id)
      .order('sequence_num', { ascending: false })
      .limit(config.MAX_RECENT_MESSAGES);

    context.recentMessages = (messages || []).reverse();
  }

  // 2. Get relevant knowledge for this project
  let knowledgeQuery = from('dev_ai_knowledge')
    .select('id, category, title, summary, tags, importance')
    .order('importance', { ascending: false })
    .limit(config.MAX_CONTEXT_ITEMS);

  if (projectPath) {
    knowledgeQuery = knowledgeQuery.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  const { data: knowledge } = await knowledgeQuery;
  context.relevantKnowledge = knowledge || [];

  // 3. Get any pending decisions or notes
  let decisionsQuery = from('dev_ai_decisions')
    .select('title, decision, rationale, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (projectPath) {
    decisionsQuery = decisionsQuery.eq('project_path', projectPath);
  }

  const { data: decisions } = await decisionsQuery;
  context.pendingTasks = decisions || [];

  // 4. Build greeting message
  context.greeting = buildGreeting(context);

  logger.info('Context built', {
    projectPath,
    hasLastSession: !!context.lastSession,
    messageCount: context.recentMessages.length,
    knowledgeCount: context.relevantKnowledge.length
  });

  return context;
}

/**
 * Build personalized greeting for Claude
 */
function buildGreeting(context) {
  const parts = [];

  parts.push("Hey Claude, welcome back! Here's where we left off:");

  if (context.lastSession) {
    const ago = timeAgo(new Date(context.lastSession.endedAt));
    parts.push(`\nLast session was ${ago}.`);

    if (context.lastSession.summary) {
      parts.push(`Summary: ${context.lastSession.summary}`);
    }
  } else {
    parts.push("\nThis looks like a new project - no previous sessions found.");
  }

  if (context.recentMessages.length > 0) {
    parts.push("\n**Recent conversation:**");
    context.recentMessages.slice(-5).forEach(m => {
      const role = m.role === 'user' ? 'User' : 'Claude';
      const preview = m.content.length > 100 ?
        m.content.slice(0, 100) + '...' : m.content;
      parts.push(`- ${role}: ${preview}`);
    });
  }

  if (context.relevantKnowledge.length > 0) {
    parts.push("\n**Things I remember about this project:**");
    context.relevantKnowledge.slice(0, 5).forEach(k => {
      parts.push(`- [${k.category}] ${k.title}`);
    });
  }

  parts.push("\nWhat would you like to work on?");

  return parts.join('\n');
}

/**
 * Human-readable time ago
 */
function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count > 0) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

module.exports = router;
