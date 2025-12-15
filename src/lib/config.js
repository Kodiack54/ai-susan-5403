/**
 * Susan Configuration
 * Environment-based config with validation
 */

const config = {
  PORT: parseInt(process.env.PORT) || 5403,

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,

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

// Validate required config
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY'];
const missing = required.filter(key => !config[key]);

if (missing.length > 0) {
  console.error(`Missing required config: ${missing.join(', ')}`);
  console.error('Please check your .env file');
}

module.exports = config;
