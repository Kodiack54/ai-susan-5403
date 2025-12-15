/**
 * Susan's Chad Client
 * HTTP client for communicating with Chad (Port 5401)
 */

const config = require('../lib/config');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:ChadClient');

/**
 * Check if Chad is available
 */
async function isAvailable() {
  try {
    const response = await fetch(`${config.CHAD_URL}/health`);
    const data = await response.json();
    return data.status === 'ok';
  } catch (err) {
    return false;
  }
}

/**
 * Get active sessions from Chad
 */
async function getActiveSessions() {
  try {
    const response = await fetch(`${config.CHAD_URL}/api/sessions`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    logger.error('Failed to get sessions from Chad', { error: err.message });
    return [];
  }
}

/**
 * Get session messages from Chad
 */
async function getSessionMessages(sessionId) {
  try {
    const response = await fetch(`${config.CHAD_URL}/api/sessions/${sessionId}/messages`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    logger.error('Failed to get session messages from Chad', {
      error: err.message,
      sessionId
    });
    return [];
  }
}

/**
 * Get recent conversations from Chad
 */
async function getRecentConversations(options = {}) {
  const { limit = 20, project } = options;

  try {
    const url = new URL(`${config.CHAD_URL}/api/recent`);
    url.searchParams.set('limit', limit);
    if (project) {
      url.searchParams.set('project', project);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    logger.error('Failed to get recent conversations from Chad', {
      error: err.message
    });
    return [];
  }
}

/**
 * Get Chad's health status
 */
async function getHealth() {
  try {
    const response = await fetch(`${config.CHAD_URL}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    return {
      status: 'unreachable',
      error: err.message
    };
  }
}

module.exports = {
  isAvailable,
  getActiveSessions,
  getSessionMessages,
  getRecentConversations,
  getHealth
};
