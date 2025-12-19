/**
 * Extraction Sorter - Processes pending extractions from Chad
 * Sorts items from dev_ai_smart_extractions into proper destination tables
 */

const { from, query } = require('../lib/db');
const { Logger } = require('../lib/logger');
// Helper to get routing info from project path
async function getRoutingFromPath(projectPath) {
  if (!projectPath) return {};
  try {
    const { data: pathInfo } = await from('dev_project_paths')
      .select('project_id')
      .eq('path', projectPath)
      .limit(1);
    if (pathInfo?.[0]?.project_id) {
      const { data: proj } = await from('dev_projects')
        .select('client_id, platform_id, id')
        .eq('id', pathInfo[0].project_id)
        .single();
      if (proj) {
        return { client_id: proj.client_id, platform_id: proj.platform_id, project_id: proj.id };
      }
    }
  } catch (e) {}
  return {};
}


const logger = new Logger('Sorter');
const projectDetector = require('./projectDetector');
const { stripAnsi } = require('../../shared/stripAnsi');

const CATEGORY_TO_TABLE = {
  todo: 'dev_ai_todos',
  bug: 'dev_ai_bugs',
  issue: 'dev_ai_bugs',
  knowledge: 'dev_ai_knowledge',
  solution: 'dev_ai_knowledge',
  config: 'dev_ai_knowledge',
  infrastructure: 'dev_ai_knowledge',
  decision: 'dev_ai_decisions',
  lesson: 'dev_ai_lessons'
};

// Patterns that indicate garbage data - skip these
const GARBAGE_PATTERNS = [
  /^\|/,                    // Starts with pipe (table output)
  /^\(\d+\)/,               // Starts with (8) etc
  /^- MMO/,                 // MMO task references
  /^be saved by/,           // Partial sentences
  /^GET\s+\/api/,           // API routes
  /\[.*m$/,                 // Ends with color code
  /^'\w+_ai/,               // Table name references
  /\\x1B/,                  // Escaped ANSI
  /\\u001b/i,               // Unicode ANSI
];

function isGarbage(text) {
  if (!text || text.length < 10) return true;
  if (text.length > 5000) return true;  // Too long
  return GARBAGE_PATTERNS.some(p => p.test(text));
}

async function processPendingExtractions() {
  try {
    const { data: pending, error } = await from('dev_ai_smart_extractions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      logger.error('Error fetching pending extractions', { error: error.message });
      return { processed: 0, errors: 1 };
    }

    if (!pending || pending.length === 0) {
      return { processed: 0, errors: 0 };
    }

    logger.info(`[Sorter] Processing ${pending.length} pending extractions`);

    let processed = 0;
    let errors = 0;
    let skipped = 0;

    for (const extraction of pending) {
      try {
        // Clean the content first
        const cleanContent = stripAnsi(extraction.content || '');
        
        // Skip garbage
        if (isGarbage(cleanContent)) {
          await from('dev_ai_smart_extractions')
            .update({ status: 'skipped' })
            .eq('id', extraction.id);
          skipped++;
          continue;
        }

        extraction.content = cleanContent;
        const result = await sortExtraction(extraction);
        if (result.success) {
          processed++;
        } else {
          errors++;
        }
      } catch (err) {
        logger.error('Error processing extraction', { id: extraction.id, error: err.message });
        errors++;
      }
    }

    logger.info(`[Sorter] Processed ${processed}, skipped ${skipped}, errors ${errors}`);
    return { processed, errors, skipped };
  } catch (err) {
    logger.error('Error in processPendingExtractions', { error: err.message });
    return { processed: 0, errors: 1 };
  }
}

async function sortExtraction(extraction) {
  const { id, category, content, project_path, priority, metadata, session_id } = extraction;

  const targetTable = CATEGORY_TO_TABLE[category] || 'dev_ai_knowledge';

  let finalProjectPath = project_path;
  if (!finalProjectPath && content) {
    const detected = await projectDetector.detectProject(content);
    if (detected) {
      finalProjectPath = detected.server_path;
    }
  }

  try {
    if (targetTable === 'dev_ai_todos') {
      await insertTodo(extraction, finalProjectPath);
    } else if (targetTable === 'dev_ai_bugs') {
      await insertBug(extraction, finalProjectPath);
    } else if (targetTable === 'dev_ai_knowledge') {
      await insertKnowledge(extraction, finalProjectPath);
    } else if (targetTable === 'dev_ai_decisions') {
      await insertDecision(extraction, finalProjectPath);
    } else if (targetTable === 'dev_ai_lessons') {
      await insertLesson(extraction, finalProjectPath);
    }

    await from('dev_ai_smart_extractions')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', id);

    return { success: true };
  } catch (err) {
    logger.error('Error sorting extraction', { id, error: err.message });
    
    await from('dev_ai_smart_extractions')
      .update({ status: 'failed', metadata: { ...metadata, error: err.message } })
      .eq('id', id);

    return { success: false, error: err.message };
  }
}

async function insertTodo(extraction, projectPath) {
  const { content, priority, session_id, client_id, platform_id, project_id } = extraction;
  const title = content.substring(0, 200).split('\n')[0];  // First line as title
  
  // Get routing from project path if not provided
  let routingInfo = { client_id, platform_id, project_id };
  if (!client_id && projectPath) {
    const { data: pathInfo } = await from('dev_project_paths')
      .select('project_id')
      .eq('path', projectPath)
      .limit(1);
    if (pathInfo?.[0]?.project_id) {
      const { data: proj } = await from('dev_projects')
        .select('client_id, platform_id, id')
        .eq('id', pathInfo[0].project_id)
        .single();
      if (proj) {
        routingInfo = { client_id: proj.client_id, platform_id: proj.platform_id, project_id: proj.id };
      }
    }
  }
  
  await from('dev_ai_todos').insert({
    project_path: projectPath || '/var/www/NextBid_Dev/dev-studio-5000',
    title: title,
    description: content,
    priority: mapPriority(priority),
    status: 'pending',
    source_session_id: session_id,
    client_id: routingInfo.client_id || null,
    platform_id: routingInfo.platform_id || null,
    project_id: routingInfo.project_id || null
  });
}

async function insertBug(extraction, projectPath) {
  const { content, priority, category, session_id } = extraction;
  const title = content.substring(0, 200).split('\n')[0];
  const routing = await getRoutingFromPath(projectPath);
  
  await from('dev_ai_bugs').insert({
    project_path: projectPath,
    title: title,
    description: content,
    severity: mapPriority(priority),
    status: 'open',
    source_session_id: session_id,
    client_id: routing.client_id || null,
    platform_id: routing.platform_id || null,
    project_id: routing.project_id || null
  });
}

async function insertKnowledge(extraction, projectPath) {
  const { content, category, session_id } = extraction;
  const title = content.substring(0, 200).split('\n')[0];
  const routing = await getRoutingFromPath(projectPath);
  
  await from('dev_ai_knowledge').insert({
    project_path: projectPath,
    title: title,
    content: content,
    category: category || 'general',
    source_session_id: session_id,
    client_id: routing.client_id || null,
    platform_id: routing.platform_id || null,
    project_id: routing.project_id || null
  });
}

async function insertDecision(extraction, projectPath) {
  const { content, session_id } = extraction;
  const title = content.substring(0, 200).split('\n')[0];
  const routing = await getRoutingFromPath(projectPath);
  
  await from('dev_ai_decisions').insert({
    project_path: projectPath,
    title: title,
    description: content,
    status: 'decided',
    source_session_id: session_id,
    client_id: routing.client_id || null,
    platform_id: routing.platform_id || null,
    project_id: routing.project_id || null
  });
}

async function insertLesson(extraction, projectPath) {
  const { content, session_id } = extraction;
  const title = content.substring(0, 200).split('\n')[0];
  const routing = await getRoutingFromPath(projectPath);
  
  await from('dev_ai_lessons').insert({
    project_path: projectPath,
    title: title,
    content: content,
    source_session_id: session_id,
    client_id: routing.client_id || null,
    platform_id: routing.platform_id || null,
    project_id: routing.project_id || null
  });
}

function mapPriority(priority) {
  const map = { low: 'low', normal: 'medium', high: 'high', critical: 'critical' };
  return map[priority] || 'medium';
}

function mapSeverity(priority) {
  const map = { low: 'low', normal: 'medium', high: 'high', critical: 'critical' };
  return map[priority] || 'medium';
}

let sortInterval = null;

function startSorter() {
  if (sortInterval) return;
  
  logger.info('[Sorter] Starting extraction sorter (30s interval)');
  processPendingExtractions();
  sortInterval = setInterval(processPendingExtractions, 30000);
}

function stopSorter() {
  if (sortInterval) {
    clearInterval(sortInterval);
    sortInterval = null;
    logger.info('[Sorter] Stopped extraction sorter');
  }
}

module.exports = {
  processPendingExtractions,
  sortExtraction,
  startSorter,
  stopSorter
};

// Import new knowledge classifier
const knowledgeClassifier = require('./knowledgeClassifier');

/**
 * Process categorized knowledge items from Chad's new format
 * These come with suggestedCategory and confidence from Chad
 */
async function processCategorizedKnowledge(knowledgeItems, context = {}) {
  if (!knowledgeItems || knowledgeItems.length === 0) {
    return { processed: 0, stored: 0 };
  }
  
  logger.info(`[Sorter] Processing ${knowledgeItems.length} categorized knowledge items`);
  
  const result = await knowledgeClassifier.processKnowledgeItems(knowledgeItems, context);
  
  logger.info(`[Sorter] Categorized knowledge: ${result.stored} stored, ${result.overridden} category overrides`);
  
  return result;
}

/**
 * Enhanced extraction processor that handles both old and new formats
 */
async function processSmartExtraction(extraction, context = {}) {
  const { sessionId, projectPath, clientId, projectId } = context;
  
  // Check if this is the new format with knowledgeItems
  if (extraction.knowledgeItems && extraction.knowledgeItems.length > 0) {
    // Process with new classifier
    const result = await processCategorizedKnowledge(extraction.knowledgeItems, {
      sessionId,
      projectPath,
      clientId,
      projectId
    });
    
    return {
      format: 'new',
      ...result
    };
  }
  
  // Fall back to old format processing
  // (legacy knowledge, decisions, bugs arrays without category suggestions)
  let processed = 0;
  
  if (extraction.knowledge) {
    for (const k of extraction.knowledge) {
      await insertKnowledge({
        content: `${k.title}: ${k.summary}`,
        category: k.category || 'general',
        session_id: sessionId
      }, projectPath);
      processed++;
    }
  }
  
  if (extraction.decisions) {
    for (const d of extraction.decisions) {
      await insertDecision({
        content: `${d.title}: ${d.rationale}`,
        session_id: sessionId
      }, projectPath);
      processed++;
    }
  }
  
  if (extraction.bugs) {
    for (const b of extraction.bugs) {
      await insertBug({
        content: b.title,
        priority: b.severity,
        session_id: sessionId
      }, projectPath);
      processed++;
    }
  }
  
  return {
    format: 'legacy',
    processed
  };
}

// Export new functions
module.exports.processCategorizedKnowledge = processCategorizedKnowledge;
module.exports.processSmartExtraction = processSmartExtraction;
