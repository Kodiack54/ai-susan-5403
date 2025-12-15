/**
 * Susan Cataloger Registry
 * Plugin discovery and management for knowledge catalogers
 */

const fs = require('fs');
const path = require('path');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:CatalogerRegistry');

class CatalogerRegistry {
  constructor() {
    this.catalogers = new Map();
  }

  /**
   * Discover and load all catalogers from the catalogers directory
   */
  async discover() {
    const catalogersDir = __dirname;
    const entries = fs.readdirSync(catalogersDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(catalogersDir, entry.name, 'config.json');
      if (!fs.existsSync(configPath)) continue;

      try {
        const config = require(configPath);

        if (!config.enabled) {
          logger.info('Cataloger disabled', { name: config.name });
          continue;
        }

        const catalogerPath = path.join(catalogersDir, entry.name, config.scripts?.cataloger || 'cataloger.js');
        if (!fs.existsSync(catalogerPath)) {
          logger.warn('Cataloger script not found', { name: config.name, path: catalogerPath });
          continue;
        }

        const cataloger = require(catalogerPath);

        this.catalogers.set(config.name, {
          config,
          cataloger,
          priority: config.priority || 0
        });

        logger.info('Cataloger loaded', {
          name: config.name,
          displayName: config.displayName,
          priority: config.priority || 0
        });
      } catch (err) {
        logger.error('Failed to load cataloger', {
          directory: entry.name,
          error: err.message
        });
      }
    }

    // Sort by priority (higher first)
    this.sortedCatalogers = Array.from(this.catalogers.values())
      .sort((a, b) => (b.config.priority || 0) - (a.config.priority || 0));

    logger.info('Cataloger discovery complete', { count: this.catalogers.size });
  }

  /**
   * Get a cataloger by name
   */
  get(name) {
    return this.catalogers.get(name);
  }

  /**
   * Find first matching cataloger for given content
   */
  findMatching(content, metadata = {}) {
    for (const { cataloger, config } of this.sortedCatalogers) {
      try {
        if (cataloger.matches && cataloger.matches(content, metadata)) {
          return cataloger;
        }
      } catch (err) {
        logger.error('Cataloger match check failed', {
          name: config.name,
          error: err.message
        });
      }
    }
    return null;
  }

  /**
   * Find all matching catalogers for given content
   */
  findAllMatching(content, metadata = {}) {
    const matches = [];

    for (const { cataloger, config } of this.sortedCatalogers) {
      try {
        if (cataloger.matches && cataloger.matches(content, metadata)) {
          matches.push(cataloger);
        }
      } catch (err) {
        logger.error('Cataloger match check failed', {
          name: config.name,
          error: err.message
        });
      }
    }

    return matches;
  }

  /**
   * Get count of loaded catalogers
   */
  count() {
    return this.catalogers.size;
  }

  /**
   * List all loaded catalogers
   */
  list() {
    return Array.from(this.catalogers.entries()).map(([name, { config }]) => ({
      name,
      displayName: config.displayName,
      enabled: config.enabled,
      priority: config.priority || 0,
      triggers: config.triggers || []
    }));
  }
}

// Export singleton instance
module.exports = new CatalogerRegistry();
