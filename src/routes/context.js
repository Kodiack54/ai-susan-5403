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
    todos: [],
    projectInfo: null,
    ports: [],
    schemas: []
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

  // 4. Get pending todos for this project
  let todosQuery = from('dev_ai_todos')
    .select('id, title, description, priority, category, status, created_at')
    .in('status', ['pending', 'in_progress'])
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(10);

  if (projectPath) {
    todosQuery = todosQuery.eq('project_path', projectPath);
  }

  const { data: todos } = await todosQuery;
  context.todos = todos || [];

  // 5. Get project structure (ports, services)
  if (projectPath) {
    const { data: structure } = await from('dev_ai_structures')
      .select('project_path, project_name, ports, services, databases')
      .eq('project_path', projectPath)
      .single();

    if (structure) {
      context.projectInfo = {
        name: structure.project_name,
        path: structure.project_path,
        services: structure.services || [],
        databases: structure.databases || []
      };
      context.ports = structure.ports || [];
    }
  }

  // 6. Get schema info (tables)
  let schemaQuery = from('dev_ai_schemas')
    .select('table_name, prefix, column_count, description')
    .order('table_name', { ascending: true })
    .limit(20);

  if (projectPath) {
    schemaQuery = schemaQuery.eq('project_path', projectPath);
  }

  const { data: schemas } = await schemaQuery;
  context.schemas = schemas || [];

  // 7. Get file structure info (key directories/files)
  if (projectPath) {
    const { data: fileStructure } = await from('dev_ai_file_structures')
      .select('directories, key_files, updated_at')
      .eq('project_path', projectPath)
      .single();

    if (fileStructure) {
      context.fileStructure = {
        directories: fileStructure.directories || [],
        keyFiles: fileStructure.key_files || [],
        updatedAt: fileStructure.updated_at
      };
    }
  }

  // 8. Build greeting message
  context.greeting = buildGreeting(context);

  logger.info('Context built', {
    projectPath,
    hasLastSession: !!context.lastSession,
    messageCount: context.recentMessages.length,
    knowledgeCount: context.relevantKnowledge.length,
    todoCount: context.todos.length,
    portCount: context.ports.length
  });

  return context;
}

/**
 * Build personalized greeting for Claude
 */
function buildGreeting(context) {
  const parts = [];

  parts.push("=== SUSAN'S MEMORY BRIEFING ===");
  parts.push("Hey Claude, I've gathered everything you need to know:");

  // Project Info
  if (context.projectInfo) {
    parts.push(`\n📁 PROJECT: ${context.projectInfo.name}`);
    parts.push(`   Path: ${context.projectInfo.path}`);
    if (context.projectInfo.databases?.length > 0) {
      parts.push(`   Databases: ${context.projectInfo.databases.join(', ')}`);
    }
  }

  // Port Assignments
  if (context.ports?.length > 0) {
    parts.push("\n🔌 PORTS:");
    context.ports.forEach(p => {
      parts.push(`   ${p.port} - ${p.service || p.name}${p.description ? ` (${p.description})` : ''}`);
    });
  }

  // Pending Todos
  if (context.todos?.length > 0) {
    parts.push("\n📋 TODO LIST:");
    context.todos.forEach((t, i) => {
      const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      const status = t.status === 'in_progress' ? '⏳' : '⬜';
      parts.push(`   ${status} ${priority} ${t.title}`);
      if (t.description) {
        parts.push(`      └─ ${t.description.slice(0, 80)}${t.description.length > 80 ? '...' : ''}`);
      }
    });
  }

  // Database Tables
  if (context.schemas?.length > 0) {
    parts.push("\n🗄️ DATABASE TABLES:");
    const byPrefix = {};
    context.schemas.forEach(s => {
      const prefix = s.prefix || 'other';
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(s.table_name);
    });
    Object.entries(byPrefix).forEach(([prefix, tables]) => {
      parts.push(`   ${prefix}: ${tables.join(', ')}`);
    });
  }

  // Last Session
  if (context.lastSession) {
    const ago = timeAgo(new Date(context.lastSession.endedAt));
    parts.push(`\n⏰ LAST SESSION: ${ago}`);
    if (context.lastSession.summary) {
      parts.push(`   Summary: ${context.lastSession.summary}`);
    }
  }

  // Recent Conversation
  if (context.recentMessages?.length > 0) {
    parts.push("\n💬 RECENT CONVERSATION:");
    context.recentMessages.slice(-3).forEach(m => {
      const role = m.role === 'user' ? 'Boss' : 'You';
      const preview = m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content;
      parts.push(`   ${role}: ${preview}`);
    });
  }

  // File Structure
  if (context.fileStructure) {
    if (context.fileStructure.directories?.length > 0) {
      parts.push("\n📂 KEY DIRECTORIES:");
      context.fileStructure.directories.slice(0, 10).forEach(d => {
        parts.push(`   ${d.path}${d.description ? ` - ${d.description}` : ''}`);
      });
    }
    if (context.fileStructure.keyFiles?.length > 0) {
      parts.push("\n📄 KEY FILES:");
      context.fileStructure.keyFiles.slice(0, 10).forEach(f => {
        parts.push(`   ${f.path}${f.description ? ` - ${f.description}` : ''}`);
      });
    }
  }

  // Knowledge
  if (context.relevantKnowledge?.length > 0) {
    parts.push("\n🧠 KEY KNOWLEDGE:");
    context.relevantKnowledge.slice(0, 5).forEach(k => {
      parts.push(`   [${k.category}] ${k.title}`);
    });
  }

  parts.push("\n=== END BRIEFING ===");
  parts.push("Ready to continue where we left off. What's the priority?");

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
