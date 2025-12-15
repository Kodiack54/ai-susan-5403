/**
 * Susan's OpenAI Client
 * Knowledge extraction and chat capabilities
 */

const OpenAI = require('openai');
const config = require('./config');
const { Logger } = require('./logger');

const logger = new Logger('Susan:OpenAI');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENAI_API_KEY
    });
  }
  return client;
}

/**
 * Extract knowledge from Claude's response
 */
async function extractKnowledge(content) {
  const response = await getClient().chat.completions.create({
    model: config.OPENAI_MODEL,
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

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Summarize a session conversation
 */
async function summarizeSession(conversation) {
  const response = await getClient().chat.completions.create({
    model: config.OPENAI_MODEL,
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

  return response.choices[0].message.content;
}

/**
 * Chat with Susan
 */
async function chat(message, context = {}) {
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

  const response = await getClient().chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
    max_tokens: 500,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

module.exports = {
  getClient,
  extractKnowledge,
  summarizeSession,
  chat
};
