/**
 * Susan - AI Team Librarian (Port 5403)
 *
 * Catalogs knowledge, organizes conversations, provides Claude with
 * persistent memory across sessions.
 *
 * When Claude connects, Susan provides:
 * - Last session summary
 * - Recent conversations
 * - Relevant knowledge items
 * - Database schemas
 * - Project context
 */

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 5403;

// Supabase connection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// OpenAI for knowledge extraction
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ============================================
// CONTEXT - What Claude needs on startup
// ============================================

/**
 * Get startup context for Claude
 * Called when Claude connects to give him memory
 */
app.get('/api/context', async (req, res) => {
  const projectPath = req.query.project || req.query.path;
  const userId = req.query.userId;

  try {
    const context = await buildStartupContext(projectPath, userId);
    res.json(context);
  } catch (err) {
    console.error('[Susan] Context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
  let sessionQuery = supabase.from('dev_ai_sessions')
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
    const { data: messages } = await supabase.from('dev_ai_messages')
      .select('role, content, created_at')
      .eq('session_id', session.id)
      .order('sequence_num', { ascending: false })
      .limit(20);

    context.recentMessages = (messages || []).reverse();
  }

  // 2. Get relevant knowledge for this project
  let knowledgeQuery = supabase.from('dev_ai_knowledge')
    .select('id, category, title, summary, tags, importance')
    .order('importance', { ascending: false })
    .limit(10);

  if (projectPath) {
    knowledgeQuery = knowledgeQuery.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  const { data: knowledge } = await knowledgeQuery;
  context.relevantKnowledge = knowledge || [];

  // 3. Get any pending decisions or notes
  let decisionsQuery = supabase.from('dev_ai_decisions')
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

  return context;
}

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

// ============================================
// MESSAGE - Receive from Chad, extract knowledge
// ============================================

app.post('/api/message', async (req, res) => {
  const { sessionId, projectPath, message } = req.body;

  try {
    // Check if this message contains something worth remembering
    if (message.role === 'assistant' && message.content.length > 50) {
      await extractKnowledge(sessionId, projectPath, message.content);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Susan] Message processing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function extractKnowledge(sessionId, projectPath, content) {
  // Skip short or trivial messages
  if (content.length < 100) return;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Susan, an AI librarian. Analyze Claude's response and extract any knowledge worth remembering.

Look for:
- Solutions to problems
- Code patterns used
- Architectural decisions
- Bug fixes and their causes
- File structures explained
- Database changes
- Important configurations

Return JSON:
{
  "shouldRemember": boolean,
  "knowledge": {
    "category": "bug-fix" | "feature" | "architecture" | "database" | "config" | "explanation" | "other",
    "title": "Short descriptive title",
    "summary": "2-3 sentence summary",
    "tags": ["tag1", "tag2"],
    "importance": 1-10
  }
}

If nothing worth remembering, set shouldRemember: false.`
        },
        {
          role: 'user',
          content: `Analyze this Claude response:\n\n${content.slice(0, 4000)}`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.1
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.shouldRemember && result.knowledge) {
      const k = result.knowledge;
      const { error } = await supabase.from('dev_ai_knowledge').insert({
        session_id: sessionId,
        project_path: projectPath,
        category: k.category,
        title: k.title,
        summary: k.summary,
        tags: k.tags || [],
        importance: k.importance || 5
      });

      if (error) throw error;
      console.log(`[Susan] Remembered: [${k.category}] ${k.title}`);
    }
  } catch (err) {
    console.error('[Susan] Knowledge extraction error:', err.message);
  }
}

// ============================================
// SUMMARIZE - Called when session ends
// ============================================

app.post('/api/summarize', async (req, res) => {
  const { sessionId } = req.body;

  try {
    // Get all messages from session
    const { data: messages, error: msgError } = await supabase.from('dev_ai_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('sequence_num', { ascending: true });

    if (msgError) throw msgError;

    if (!messages || messages.length === 0) {
      return res.json({ success: true, summary: null });
    }

    // Build conversation for summarization
    const conversation = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.content}`)
      .join('\n\n');

    // Summarize with GPT-4o-mini
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Summarize this development session in 2-3 sentences. Focus on:
- What was the main task/goal?
- What was accomplished?
- Any important decisions or blockers?`
        },
        {
          role: 'user',
          content: conversation.slice(0, 8000)
        }
      ],
      max_tokens: 200
    });

    const summary = response.choices[0].message.content;

    // Update session with summary
    const { error: updateError } = await supabase.from('dev_ai_sessions')
      .update({ summary })
      .eq('id', sessionId);

    if (updateError) throw updateError;

    console.log(`[Susan] Session summarized: ${summary.slice(0, 50)}...`);
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[Susan] Summarization error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// QUERY - Search knowledge base
// ============================================

app.get('/api/query', async (req, res) => {
  const { q, project, category, limit = 10 } = req.query;

  try {
    let query = supabase.from('dev_ai_knowledge')
      .select('id, category, title, summary, tags, importance, created_at')
      .order('importance', { ascending: false })
      .limit(parseInt(limit));

    if (q) {
      // Text search using ilike since Supabase doesn't support full-text search easily
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

    // Update reference counts for queried items
    if (data && data.length > 0 && q) {
      const ids = data.map(r => r.id);
      // Note: Supabase doesn't support increment directly, would need RPC for this
      // For now, skip the reference count update
    }

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// REMEMBER - Manually add knowledge
// ============================================

app.post('/api/remember', async (req, res) => {
  const { category, title, summary, details, tags, projectPath, importance } = req.body;

  try {
    const { data, error } = await supabase.from('dev_ai_knowledge')
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

    console.log(`[Susan] Manually remembered: ${title}`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SCHEMA - Store/retrieve database schemas
// ============================================

app.post('/api/schema', async (req, res) => {
  const { databaseName, tableName, schema, description } = req.body;

  try {
    const { error } = await supabase.from('dev_ai_schemas')
      .upsert({
        database_name: databaseName,
        table_name: tableName,
        schema_definition: schema,
        description,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'database_name,table_name'
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schemas', async (req, res) => {
  const { database } = req.query;

  try {
    let query = supabase.from('dev_ai_schemas')
      .select('database_name, table_name, schema_definition, description')
      .order('database_name')
      .order('table_name');

    if (database) {
      query = query.eq('database_name', database);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DECISIONS - Track architectural decisions
// ============================================

app.post('/api/decision', async (req, res) => {
  const { sessionId, title, context, decision, alternatives, rationale, projectPath, tags } = req.body;

  try {
    const { data, error } = await supabase.from('dev_ai_decisions')
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

    console.log(`[Susan] Decision recorded: ${title}`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CHAT - Direct conversation with Susan
// ============================================

app.post('/api/chat', async (req, res) => {
  const { message, context, projectPath } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Get knowledge base for context
    const { data: knowledge } = await supabase.from('dev_ai_knowledge')
      .select('category, title, summary')
      .order('importance', { ascending: false })
      .limit(10);

    // Get recent decisions
    const { data: decisions } = await supabase.from('dev_ai_decisions')
      .select('title, decision, rationale')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get schemas if available
    const { data: schemas } = await supabase.from('dev_ai_schemas')
      .select('database_name, table_name, description')
      .limit(20);

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

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Susan, the AI Team Librarian at NextBid Dev Studio. You work on port 5403.

Your job:
- Catalog all conversations and extract knowledge
- Remember what Claude worked on across sessions
- Store database schemas, file structures, port assignments
- Provide context to Claude when he starts a new session
- Answer questions about the codebase, past work, and project details

Personality: Organized, helpful, great memory for details. You love categorizing and finding information.

${knowledgeContext}

${decisionContext}

${schemaContext}

${context ? `Additional context: ${context}` : ''}

Keep responses helpful and informative. You can tell the user about what's been cataloged, search for specific knowledge, explain database schemas, or help them understand the project history.

If the user wants you to remember something, acknowledge it and explain you'll catalog it. If they ask about something you don't know yet, say so and offer to learn it.`
        },
        {
          role: 'user',
          content: message
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const reply = response.choices[0].message.content;
    console.log(`[Susan] Chat: "${message.slice(0, 50)}..." -> "${reply.slice(0, 50)}..."`);

    res.json({
      success: true,
      reply,
      from: 'susan'
    });
  } catch (err) {
    console.error('[Susan] Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HEALTH
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'susan-librarian',
    port: PORT
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
====================================
  Susan - AI Team Librarian
  Port: ${PORT}
====================================

  HTTP API:  http://localhost:${PORT}

  Endpoints:
    GET  /health
    GET  /api/context?project=...     Claude startup context
    POST /api/message                  From Chad - extract knowledge
    POST /api/summarize                Summarize ended session
    GET  /api/query?q=...             Search knowledge
    POST /api/remember                 Manually add knowledge
    POST /api/schema                   Store table schema
    GET  /api/schemas                  Get stored schemas
    POST /api/decision                 Record architecture decision
    POST /api/chat                     <-- NEW: Chat with Susan

  Ready to organize Claude's memory.
====================================
  `);
});
