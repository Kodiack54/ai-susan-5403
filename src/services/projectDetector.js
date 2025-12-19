/**
 * Susan Project Detector
 * Analyzes content to determine which project it belongs to
 * instead of blindly trusting session project_path
 */

const { Logger } = require('../lib/logger');
const logger = new Logger('Susan:ProjectDetector');

// Known projects with detection patterns
const PROJECTS = {
  'engine-dev-5101': {
    name: 'NextBid Engine',
    aliases: ['engine', 'nextbid engine', 'auction engine', 'bidding engine'],
    keywords: ['auction', 'bid', 'bidding', 'lot', 'paddle', 'gavel', 'hammer', 'reserve', 'increment', 'proxy bid', 'absentee', 'live auction', 'tradeline', 'solicitation', 'opportunity', 'contract'],
    paths: ['engine-dev', '5101', 'engine/'],
    weight: 1.0
  },
  'source-dev-5102': {
    name: 'NextBid Source',
    aliases: ['source', 'nextbid source', 'source manager', 'inventory'],
    keywords: ['inventory', 'consignment', 'consignor', 'pickup', 'intake', 'catalog item', 'item condition', 'provenance'],
    paths: ['source-dev', '5102', 'source/'],
    weight: 1.0
  },
  'dev-studio-5000': {
    name: 'Kodiack Studio',
    aliases: ['studio', 'dev studio', 'kodiack', 'kodiack studio', 'dev-studio'],
    keywords: ['sidebar', 'panel', 'ai worker', 'chad', 'susan', 'clair', 'ryan', 'terminal', 'claude code', 'mcp'],
    paths: ['dev-studio', '5000', 'studio/'],
    weight: 0.8  // Lower weight - only match if clearly about the studio itself
  },
  'auth-7000': {
    name: 'Auth Service',
    aliases: ['auth', 'authentication', 'auth service'],
    keywords: ['login', 'logout', 'jwt', 'token', 'session', 'oauth', 'password', 'credential'],
    paths: ['auth-7000', '7000'],
    weight: 1.0
  },
  'ai-workers': {
    name: 'AI Workers',
    aliases: ['workers', 'ai workers', 'ai-workers'],
    keywords: ['cataloger', 'cleaner', 'session detector', 'project organizer', 'knowledge service'],
    paths: ['ai-workers/', 'chad-5401', 'susan-5403', 'ryan-5402', 'clair-5406'],
    weight: 0.9
  }
};

/**
 * Detect which project content belongs to
 * @param {string} content - The text content to analyze
 * @param {string} fallbackProject - Default project if none detected
 * @returns {object} { project: string, confidence: number, reason: string }
 */
function detectProject(content, fallbackProject = 'dev-studio-5000') {
  if (!content || typeof content !== 'string') {
    return { project: fallbackProject, confidence: 0, reason: 'no content' };
  }

  const contentLower = content.toLowerCase();
  const scores = {};

  for (const [projectPath, config] of Object.entries(PROJECTS)) {
    let score = 0;
    const matches = [];

    // Check aliases (strongest signal)
    for (const alias of config.aliases) {
      if (contentLower.includes(alias)) {
        score += 3 * config.weight;
        matches.push(`alias: ${alias}`);
      }
    }

    // Check file paths
    for (const pathPattern of config.paths) {
      if (content.includes(pathPattern)) {
        score += 2 * config.weight;
        matches.push(`path: ${pathPattern}`);
      }
    }

    // Check domain keywords
    for (const keyword of config.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const keywordMatches = content.match(regex);
      if (keywordMatches) {
        score += (0.5 * keywordMatches.length) * config.weight;
        matches.push(`keyword: ${keyword} (${keywordMatches.length}x)`);
      }
    }

    if (score > 0) {
      scores[projectPath] = { score, matches };
    }
  }

  // Find highest scoring project
  let bestProject = fallbackProject;
  let bestScore = 0;
  let bestMatches = [];

  for (const [projectPath, data] of Object.entries(scores)) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestProject = projectPath;
      bestMatches = data.matches;
    }
  }

  // Calculate confidence (0-1)
  const confidence = Math.min(bestScore / 10, 1);

  // Only override fallback if we're reasonably confident
  if (confidence < 0.3 && bestProject !== fallbackProject) {
    logger.debug('Low confidence detection, using fallback', {
      detected: bestProject,
      confidence,
      fallback: fallbackProject
    });
    return { project: fallbackProject, confidence: 0.1, reason: 'low confidence, using fallback' };
  }

  logger.info('Project detected', {
    project: bestProject,
    confidence: confidence.toFixed(2),
    matches: bestMatches.slice(0, 5)
  });

  return {
    project: bestProject,
    confidence,
    reason: bestMatches.slice(0, 5).join(', ')
  };
}

/**
 * Detect multiple projects mentioned in content
 * Useful for conversations that span multiple projects
 */
function detectAllProjects(content) {
  if (!content) return [];

  const contentLower = content.toLowerCase();
  const detected = [];

  for (const [projectPath, config] of Object.entries(PROJECTS)) {
    let score = 0;
    const matches = [];

    for (const alias of config.aliases) {
      if (contentLower.includes(alias)) {
        score += 3;
        matches.push(alias);
      }
    }

    for (const pathPattern of config.paths) {
      if (content.includes(pathPattern)) {
        score += 2;
        matches.push(pathPattern);
      }
    }

    if (score >= 2) {
      detected.push({
        project: projectPath,
        name: config.name,
        score,
        matches
      });
    }
  }

  return detected.sort((a, b) => b.score - a.score);
}

/**
 * Get project info by path
 */
function getProjectInfo(projectPath) {
  return PROJECTS[projectPath] || null;
}

/**
 * List all known projects
 */
function listProjects() {
  return Object.entries(PROJECTS).map(([path, config]) => ({
    path,
    name: config.name,
    aliases: config.aliases
  }));
}

module.exports = {
  detectProject,
  detectAllProjects,
  getProjectInfo,
  listProjects,
  PROJECTS
};
