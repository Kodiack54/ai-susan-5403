/**
 * Code Knowledge Cataloger
 * Extracts knowledge about code patterns, implementations, and solutions
 */

const { Logger } = require('../../lib/logger');

const logger = new Logger('Susan:CodeKnowledgeCataloger');

module.exports = {
  name: 'code-knowledge',

  /**
   * Check if this cataloger should handle the content
   */
  matches(content, metadata) {
    const patterns = [
      /function\s+\w+/,
      /class\s+\w+/,
      /const\s+\w+\s*=/,
      /export\s+(default\s+)?/,
      /import\s+.*from/,
      /async\s+function/,
      /\=>\s*\{/,
      /module\.exports/
    ];

    return patterns.some(p => p.test(content));
  },

  /**
   * Extract knowledge from code-related content
   */
  async extract(content, context) {
    const knowledge = {
      category: 'code-pattern',
      title: '',
      summary: '',
      tags: [],
      importance: 5
    };

    // Detect what kind of code this is
    if (content.includes('class ')) {
      knowledge.category = 'class-definition';
      const classMatch = content.match(/class\s+(\w+)/);
      if (classMatch) {
        knowledge.title = `Class: ${classMatch[1]}`;
        knowledge.tags.push('class', classMatch[1].toLowerCase());
      }
    } else if (content.includes('function ') || content.includes('=>')) {
      knowledge.category = 'function';
      const funcMatch = content.match(/function\s+(\w+)|const\s+(\w+)\s*=/);
      if (funcMatch) {
        const name = funcMatch[1] || funcMatch[2];
        knowledge.title = `Function: ${name}`;
        knowledge.tags.push('function', name.toLowerCase());
      }
    } else if (content.includes('import ')) {
      knowledge.category = 'dependency';
      const importMatch = content.match(/from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        knowledge.title = `Import: ${importMatch[1]}`;
        knowledge.tags.push('import', 'dependency');
      }
    }

    // Generate summary (first 200 chars)
    knowledge.summary = content.slice(0, 200).replace(/\s+/g, ' ').trim();

    // Detect common patterns
    if (content.includes('useState') || content.includes('useEffect')) {
      knowledge.tags.push('react', 'hooks');
    }
    if (content.includes('express') || content.includes('router')) {
      knowledge.tags.push('express', 'api');
    }
    if (content.includes('async') || content.includes('await')) {
      knowledge.tags.push('async');
    }
    if (content.includes('WebSocket')) {
      knowledge.tags.push('websocket', 'realtime');
    }

    logger.info('Code knowledge extracted', {
      category: knowledge.category,
      title: knowledge.title,
      tags: knowledge.tags
    });

    return knowledge;
  }
};
