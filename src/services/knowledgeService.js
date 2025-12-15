/**
 * Susan Knowledge Service
 * Manages knowledge extraction and storage
 */

const { from } = require('../lib/db');
const { extractKnowledge } = require('../lib/openai');
const { Logger } = require('../lib/logger');
const config = require('../lib/config');

const logger = new Logger('Susan:KnowledgeService');

/**
 * Initialize knowledge service
 */
async function initialize() {
  logger.info('Knowledge service initialized');
  return true;
}

/**
 * Process content for knowledge extraction
 */
async function processContent(sessionId, projectPath, content, metadata = {}) {
  if (content.length < config.MIN_CONTENT_LENGTH) {
    return null;
  }

  try {
    const result = await extractKnowledge(content);

    if (result.shouldRemember && result.knowledge) {
      return await storeKnowledge(sessionId, projectPath, result.knowledge, metadata);
    }

    return null;
  } catch (err) {
    logger.error('Knowledge processing failed', { error: err.message, sessionId });
    return null;
  }
}

/**
 * Store extracted knowledge
 */
async function storeKnowledge(sessionId, projectPath, knowledge, metadata = {}) {
  const { data, error } = await from('dev_ai_knowledge').insert({
    session_id: sessionId,
    project_path: projectPath,
    category: knowledge.category,
    title: knowledge.title,
    summary: knowledge.summary,
    details: knowledge.details,
    tags: knowledge.tags || [],
    importance: knowledge.importance || 5,
    source: metadata.source || 'extraction',
    cataloger: metadata.cataloger
  }).select('id').single();

  if (error) {
    logger.error('Knowledge storage failed', { error: error.message });
    throw error;
  }

  logger.info('Knowledge stored', {
    id: data.id,
    category: knowledge.category,
    title: knowledge.title
  });

  return data.id;
}

/**
 * Search knowledge base
 */
async function search(query, options = {}) {
  const { projectPath, category, limit = 10 } = options;

  let dbQuery = from('dev_ai_knowledge')
    .select('id, category, title, summary, tags, importance, created_at')
    .order('importance', { ascending: false })
    .limit(limit);

  if (query) {
    dbQuery = dbQuery.or(`title.ilike.%${query}%,summary.ilike.%${query}%`);
  }

  if (projectPath) {
    dbQuery = dbQuery.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  if (category) {
    dbQuery = dbQuery.eq('category', category);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;

  return data || [];
}

/**
 * Get knowledge by category
 */
async function getByCategory(category, projectPath = null, limit = 20) {
  let query = from('dev_ai_knowledge')
    .select('*')
    .eq('category', category)
    .order('importance', { ascending: false })
    .limit(limit);

  if (projectPath) {
    query = query.eq('project_path', projectPath);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

/**
 * Get most important knowledge
 */
async function getMostImportant(projectPath = null, limit = 10) {
  let query = from('dev_ai_knowledge')
    .select('*')
    .order('importance', { ascending: false })
    .limit(limit);

  if (projectPath) {
    query = query.or(`project_path.eq.${projectPath},project_path.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

/**
 * Update knowledge importance
 */
async function updateImportance(id, importance) {
  const { error } = await from('dev_ai_knowledge')
    .update({ importance })
    .eq('id', id);

  if (error) throw error;

  logger.info('Knowledge importance updated', { id, importance });
}

/**
 * Get knowledge stats
 */
async function getStats(projectPath = null) {
  let query = from('dev_ai_knowledge')
    .select('category, importance');

  if (projectPath) {
    query = query.eq('project_path', projectPath);
  }

  const { data, error } = await query;
  if (error) throw error;

  const stats = {
    total: data?.length || 0,
    byCategory: {},
    avgImportance: 0
  };

  if (data && data.length > 0) {
    let totalImportance = 0;
    data.forEach(item => {
      stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
      totalImportance += item.importance || 0;
    });
    stats.avgImportance = Math.round((totalImportance / data.length) * 10) / 10;
  }

  return stats;
}

module.exports = {
  initialize,
  processContent,
  storeKnowledge,
  search,
  getByCategory,
  getMostImportant,
  updateImportance,
  getStats
};
