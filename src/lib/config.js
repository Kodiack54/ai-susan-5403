/**
 * Susan Configuration
 * Environment-based config with validation
 */

const config = {
  PORT: parseInt(process.env.PORT) || 5403,

  // OpenAI (for background extraction work)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  // Anthropic (for chat conversations)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  // Chad connection
  CHAD_URL: process.env.CHAD_URL || 'http://localhost:5401',

  // Knowledge extraction settings
  MIN_CONTENT_LENGTH: parseInt(process.env.MIN_CONTENT_LENGTH) || 100,
  MAX_CONTEXT_ITEMS: parseInt(process.env.MAX_CONTEXT_ITEMS) || 10,
  MAX_RECENT_MESSAGES: parseInt(process.env.MAX_RECENT_MESSAGES) || 20,

  // Feature flags
  AUTO_EXTRACT_KNOWLEDGE: process.env.AUTO_EXTRACT_KNOWLEDGE !== 'false',
  DEBUG: process.env.DEBUG === 'true'
};

// Validate required config (only OpenAI needed for AI operations)
const required = ['OPENAI_API_KEY'];
const missing = required.filter(key => !config[key]);

if (missing.length > 0) {
  console.error('[Susan] Missing required config:', missing.join(', '));
}

module.exports = config;
