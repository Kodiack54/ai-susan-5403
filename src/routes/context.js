/**
 * Susan Context Routes
 * Provides startup context to Claude - includes Clair's documentation
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');
const config = require('../lib/config');

const logger = new Logger('Susan:Context');
const CLAIR_URL = 'http://localhost:5406';
const RYAN_URL = 'http://localhost:5402';

/**
 * Fetch data from Clair's API
 */
async function fetchFromClair(endpoint) {
  try {
    const response = await fetch(`${CLAIR_URL}${endpoint}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    logger.warn(`Clair fetch failed: ${endpoint}`, { error: err.message });
    return null;
  }
}

/**
 * Fetch data from Ryan's API
 */
async function fetchFromRyan(endpoint) {
  try {
    const response = await fetch(`${RYAN_URL}${endpoint}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    logger.warn(`Ryan fetch failed: ${endpoint}`, { error: err.message });
    return null;
  }
}

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
    schemas: [],
    // NEW: Clair's data
    clairSummary: null,
    clairDecisions: [],
    clairLessons: [],
    clairBugs: [],
    // NEW: Ryan's project management
    ryanBriefing: null
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

    const { data: messages } = await from('dev_ai_messages')
      .select('role, content, created_at')
      .eq('session_id', session.id)
      .order('sequence_num', { ascending: false })
      .limit(config.MAX_RECENT_MESSAGES);

    context.recentMessages = (messages || []).reverse();
  }

  // 2. Get relevant knowledge
  let knowledgeQuery = from('dev_ai_knowledge')
    .select('id, category, title, summary, tags, importance')
    .order('importance', { ascending: false })
    .limit(config.MAX_CONTEXT_ITEMS);

  if (projectPath) {
    knowledgeQuery = knowledgeQuery.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  const { data: knowledge } = await knowledgeQuery;
  context.relevantKnowledge = knowledge || [];

  // 3. Get pending decisions
  let decisionsQuery = from('dev_ai_decisions')
    .select('title, decision, rationale, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (projectPath) {
    decisionsQuery = decisionsQuery.eq('project_path', projectPath);
  }

  const { data: decisions } = await decisionsQuery;
  context.pendingTasks = decisions || [];

  // 4. Get pending todos
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

  // 6. Get schema info
  let schemaQuery = from('dev_ai_schemas')
    .select('table_name, prefix, column_count, description')
    .order('table_name', { ascending: true })
    .limit(20);

  if (projectPath) {
    schemaQuery = schemaQuery.eq('project_path', projectPath);
  }

  const { data: schemas } = await schemaQuery;
  context.schemas = schemas || [];

  // 7. Get file structure
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

  // 8. NEW: Get Clair's data
  if (projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    
    // Get journal entries (decisions, lessons, latest work_log)
    const journalData = await fetchFromClair(`/api/journal/${encodedPath}?limit=20`);
    if (journalData?.success) {
      const entries = journalData.entries || [];
      
      // Latest daily summary (from clair-daily-summary)
      const summaries = entries.filter(e => e.created_by === 'clair-daily-summary' && e.entry_type === 'work_log');
      if (summaries.length > 0) {
        context.clairSummary = {
          title: summaries[0].title,
          content: summaries[0].content?.slice(0, 500),
          date: summaries[0].created_at
        };
      }
      
      // Recent decisions (not archived)
      context.clairDecisions = entries
        .filter(e => e.entry_type === 'decision' && !e.is_archived)
        .slice(0, 5)
        .map(e => ({ title: e.title, content: e.content, date: e.created_at }));
      
      // Recent lessons
      context.clairLessons = entries
        .filter(e => e.entry_type === 'lesson' && !e.is_archived)
        .slice(0, 3)
        .map(e => ({ title: e.title, content: e.content, date: e.created_at }));
    }
    
    // Get active bugs
    const bugsData = await fetchFromClair(`/api/bugs/${encodedPath}?status=open`);
    if (bugsData?.success) {
      context.clairBugs = (bugsData.bugs || []).slice(0, 5).map(b => ({
        title: b.title,
        severity: b.severity,
        description: b.description?.slice(0, 100)
      }));
    }
  }

  // 9. NEW: Get Ryan's project briefing
  const ryanData = await fetchFromRyan(`/api/briefing`);
  if (ryanData?.success && ryanData.data) {
    const rd = ryanData.data;
    context.ryanBriefing = {
      currentFocus: rd.current_focus,
      recommendation: rd.recommendation,
      inProgress: rd.in_progress?.slice(0, 3),
      blocked: rd.blocked?.slice(0, 3),
      recentlyCompleted: rd.recently_completed?.slice(0, 3),
      tradelines: rd.tradelines,
      summary: rd.summary
    };
  }

  // 9. Build greeting message
  context.greeting = buildGreeting(context);

  logger.info('Context built', {
    projectPath,
    hasLastSession: !!context.lastSession,
    messageCount: context.recentMessages.length,
    knowledgeCount: context.relevantKnowledge.length,
    todoCount: context.todos.length,
    clairDecisions: context.clairDecisions.length,
    clairBugs: context.clairBugs.length
  });

  return context;
}

/**
 * Build personalized greeting for Claude
 */
function buildGreeting(context) {
  const parts = [];

  parts.push("=== SUSAN'S MEMORY BRIEFING ===");
  parts.push("Hey Claude, here's everything you need to know:");

  // RYAN'S PROJECT BRIEFING (strategic priorities)
  if (context.ryanBriefing) {
    const rb = context.ryanBriefing;
    parts.push(`\n🎯 PROJECT PRIORITIES (from Ryan):`);
    if (rb.currentFocus) {
      parts.push(`   CURRENT FOCUS: ${rb.currentFocus[0]?.project?.name} - ${rb.currentFocus[0]?.phase?.name}`);
      if (rb.currentFocus[0]?.rationale) parts.push(`   └─ ${rb.currentFocus[0]?.rationale}`);
    }
    if (rb.recommendation) {
      parts.push(`   RECOMMENDED NEXT: ${rb.recommendation.project} - ${rb.recommendation.phase}`);
      if (rb.recommendation.reasons) parts.push(`   └─ ${rb.recommendation.reasons.join(", ")}`);
    }
    if (rb.inProgress?.length > 0) {
      parts.push(`   IN PROGRESS:`);
      rb.inProgress.forEach(p => parts.push(`      ⏳ ${p.project_name} - ${p.name}`));
    }
    if (rb.blocked?.length > 0) {
      parts.push(`   ⚠️ BLOCKED:`);
      rb.blocked.forEach(p => parts.push(`      🚫 ${p.project_name} - ${p.name} (waiting on: ${p.blocking_project} - ${p.blocking_phase})`));
    }
    if (rb.tradelines?.live?.length > 0) {
      parts.push(`   📊 TRADELINES: ${rb.tradelines.live.length} live, ${rb.tradelines.testing?.length || 0} testing`);
    }
  }

  // CLAIR'S DAILY SUMMARY (most important - what happened yesterday)
  if (context.clairSummary) {
    parts.push(`\n📋 YESTERDAY'S WORK (from Clair):`);
    parts.push(`   ${context.clairSummary.title}`);
    parts.push(`   ${context.clairSummary.content}...`);
  }

  // ACTIVE BUGS (blockers first)
  if (context.clairBugs?.length > 0) {
    parts.push("\n🐛 ACTIVE BUGS:");
    context.clairBugs.forEach(b => {
      const sev = b.severity === 'critical' ? '🔴' : b.severity === 'high' ? '🟠' : '🟡';
      parts.push(`   ${sev} ${b.title}`);
      if (b.description) parts.push(`      └─ ${b.description}`);
    });
  }

  // RECENT DECISIONS (so Claude doesn't re-ask)
  if (context.clairDecisions?.length > 0) {
    parts.push("\n🎯 RECENT DECISIONS:");
    context.clairDecisions.forEach(d => {
      parts.push(`   • ${d.title}`);
      if (d.content) parts.push(`     └─ ${d.content.slice(0, 100)}${d.content.length > 100 ? '...' : ''}`);
    });
  }

  // LESSONS LEARNED
  if (context.clairLessons?.length > 0) {
    parts.push("\n📚 LESSONS LEARNED:");
    context.clairLessons.forEach(l => {
      parts.push(`   • ${l.title}: ${l.content?.slice(0, 80) || ''}...`);
    });
  }

  // Pending Todos
  if (context.todos?.length > 0) {
    parts.push("\n✅ TODO LIST:");
    context.todos.forEach(t => {
      const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      const status = t.status === 'in_progress' ? '⏳' : '⬜';
      parts.push(`   ${status} ${priority} ${t.title}`);
    });
  }

  // Port Assignments
  if (context.ports?.length > 0) {
    parts.push("\n🔌 PORTS:");
    context.ports.forEach(p => {
      parts.push(`   ${p.port} - ${p.service || p.name}`);
    });
  }

  // Last Session
  if (context.lastSession) {
    const ago = timeAgo(new Date(context.lastSession.endedAt));
    parts.push(`\n⏰ LAST SESSION: ${ago}`);
    if (context.lastSession.summary) {
      parts.push(`   ${context.lastSession.summary.slice(0, 200)}...`);
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
