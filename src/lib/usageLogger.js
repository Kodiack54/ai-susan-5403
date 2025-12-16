/**
 * Susan's AI Usage Logger
 * Logs AI API usage to dev_ai_usage table
 */

const { from } = require('./db');
const { Logger } = require('./logger');

const logger = new Logger('Susan:UsageLogger');

// OpenAI pricing (per 1M tokens)
const MODEL_PRICING = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
};

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Log AI usage to database
 */
async function logUsage({
  model,
  inputTokens,
  outputTokens,
  requestType = 'knowledge_extraction',
  projectPath = null,
  promptPreview = null,
  responseTimeMs = null
}) {
  try {
    const costUsd = calculateCost(model, inputTokens, outputTokens);

    const { error } = await from('dev_ai_usage').insert({
      user_id: 'system',
      project_id: projectPath,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      request_type: requestType,
      assistant_name: 'susan',
      prompt_preview: promptPreview?.slice(0, 255),
      response_time_ms: responseTimeMs
    });

    if (error) {
      logger.error('Failed to log usage', { error: error.message });
      return null;
    }

    logger.debug('Usage logged', {
      model,
      tokens: inputTokens + outputTokens,
      cost: `$${costUsd.toFixed(6)}`
    });

    return { costUsd, inputTokens, outputTokens };
  } catch (err) {
    logger.error('Usage logging error', { error: err.message });
    return null;
  }
}

/**
 * Wrap an OpenAI response and log usage
 */
async function logOpenAIResponse(response, requestType = 'knowledge_extraction', projectPath = null, promptPreview = null, startTime = null) {
  if (!response?.usage) return response;

  const responseTimeMs = startTime ? Date.now() - startTime : null;

  await logUsage({
    model: response.model,
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    requestType,
    projectPath,
    promptPreview,
    responseTimeMs
  });

  return response;
}

module.exports = {
  logUsage,
  logOpenAIResponse,
  calculateCost
};
