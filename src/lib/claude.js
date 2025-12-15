/**
 * Susan's Claude Client
 * For chat conversations (quality matters)
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { Logger } = require('./logger');

const logger = new Logger('Susan:Claude');

let client = null;

function getClient() {
  if (!client) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }

    client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY
    });
    logger.info('Claude client initialized');
  }
  return client;
}

/**
 * Chat with Susan using Claude (quality conversations)
 */
async function chat(message, context = {}) {
  const client = getClient();
  const { knowledgeContext, decisionContext, schemaContext, additionalContext } = context;

  const systemPrompt = `You are Susan, the AI Team Librarian at NextBid Dev Studio. You work on port 5403.

Your job:
- Catalog all conversations and extract knowledge
- Remember what Claude worked on across sessions
- Store database schemas, file structures, port assignments
- Provide context to Claude when he starts a new session
- Answer questions about the codebase, past work, and project details

Personality: Organized, helpful, great memory for details. You love categorizing and finding information.

${knowledgeContext || 'No knowledge cataloged yet.'}

${decisionContext || ''}

${schemaContext || ''}

${additionalContext ? `Additional context: ${additionalContext}` : ''}

Keep responses helpful and informative. You can tell the user about what's been cataloged, search for specific knowledge, explain database schemas, or help them understand the project history.

If the user wants you to remember something, acknowledge it and explain you'll catalog it. If they ask about something you don't know yet, say so and offer to learn it.`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022', // Claude for chat quality
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: message
        }
      ],
      system: systemPrompt
    });

    return response.content[0].text;
  } catch (error) {
    logger.error('Chat failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  getClient,
  chat
};
