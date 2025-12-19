/**
 * Susan Team Chat Service
 * Handles Susan's questions to the user through the shared team chat
 */

const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:TeamChat');

// Susan's worker ID (need to get from database)
let susanWorkerId = null;

async function getSusanWorkerId() {
  if (susanWorkerId) return susanWorkerId;
  
  try {
    const { data } = await from('dev_ai_workers')
      .select('id')
      .eq('name', 'Susan')
      .single();
    
    susanWorkerId = data?.id;
    return susanWorkerId;
  } catch (err) {
    logger.error('Failed to get Susan worker ID', { error: err.message });
    return null;
  }
}

/**
 * Ask a category classification question
 */
async function askCategoryQuestion(knowledgeId, title, preview, optionA, optionB, confidence) {
  try {
    const workerId = await getSusanWorkerId();
    if (!workerId) {
      logger.error('Cannot ask question - Susan worker ID not found');
      return null;
    }
    
    const question = `I found something but I'm not sure how to categorize it:

"${title}"
${preview ? `\n${preview.substring(0, 150)}...` : ''}

Is this a **${optionA}** or a **${optionB}**?

Reply with "${optionA}", "${optionB}", or tell me something else.`;

    const { data, error } = await from('dev_team_chat').insert({
      worker_id: workerId,
      direction: 'from_worker',
      message_type: 'question',
      content: question,
      context_json: {
        type: 'category_classification',
        knowledgeId: knowledgeId,
        optionA: optionA,
        optionB: optionB,
        confidence: confidence
      },
      status: 'pending',
      priority: 'normal'
    }).select('id').single();
    
    if (error) {
      logger.error('Failed to create category question', { error: error.message });
      return null;
    }
    
    logger.info('Category question posted', { knowledgeId, options: [optionA, optionB] });
    return data?.id;
  } catch (err) {
    logger.error('askCategoryQuestion failed', { error: err.message });
    return null;
  }
}

/**
 * Get Susan's pending questions
 */
async function getPendingQuestions() {
  try {
    const workerId = await getSusanWorkerId();
    if (!workerId) return [];
    
    const { data } = await from('dev_team_chat')
      .select('*')
      .eq('worker_id', workerId)
      .eq('direction', 'from_worker')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    
    return data || [];
  } catch (err) {
    logger.error('getPendingQuestions failed', { error: err.message });
    return [];
  }
}

/**
 * Process user's answer to Susan's category question
 */
async function processCategoryAnswer(questionId, answer) {
  try {
    // Get the original question
    const { data: question } = await from('dev_team_chat')
      .select('*')
      .eq('id', questionId)
      .single();
    
    if (!question) {
      logger.warn('Question not found', { questionId });
      return { success: false, error: 'Question not found' };
    }
    
    const context = question.context_json || {};
    if (context.type !== 'category_classification') {
      return { success: false, error: 'Not a category question' };
    }
    
    const knowledgeId = context.knowledgeId;
    const originalCategory = context.optionA;
    
    // Normalize answer
    let finalCategory = answer.toLowerCase().trim();
    const validCategories = ['decision', 'lesson', 'system', 'procedure', 'issue', 'reference', 'idea', 'log'];
    
    if (!validCategories.includes(finalCategory)) {
      // Try to match partial
      const match = validCategories.find(c => finalCategory.includes(c) || c.includes(finalCategory));
      if (match) {
        finalCategory = match;
      } else {
        finalCategory = 'log'; // Default fallback
      }
    }
    
    // Update knowledge with confirmed category
    await from('dev_knowledge')
      .update({
        category: finalCategory,
        category_confidence: 0.95,
        category_suggested_by: 'user',
        status: 'active'
      })
      .eq('id', knowledgeId);
    
    // Mark question as answered
    await from('dev_team_chat')
      .update({ 
        status: 'answered',
        read_at: new Date().toISOString()
      })
      .eq('id', questionId);
    
    // Record user's answer
    const workerId = await getSusanWorkerId();
    await from('dev_team_chat').insert({
      worker_id: workerId,
      direction: 'to_worker',
      message_type: 'answer',
      content: answer,
      response_to: questionId,
      status: 'acknowledged'
    });
    
    // Log correction if different from suggestion
    if (finalCategory !== originalCategory) {
      await from('dev_knowledge_corrections').insert({
        knowledge_id: knowledgeId,
        field_corrected: 'category',
        original_value: originalCategory,
        corrected_value: finalCategory,
        correction_reason: 'user_answered',
        corrected_by: 'user',
        learned: false
      });
    }
    
    logger.info('Category answer processed', {
      knowledgeId,
      finalCategory,
      wasCorrection: finalCategory !== originalCategory
    });
    
    return {
      success: true,
      knowledgeId,
      category: finalCategory,
      wasCorrection: finalCategory !== originalCategory
    };
  } catch (err) {
    logger.error('processCategoryAnswer failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Send a notification (not a question)
 */
async function notify(message, priority = 'low') {
  try {
    const workerId = await getSusanWorkerId();
    if (!workerId) return null;
    
    const { data } = await from('dev_team_chat').insert({
      worker_id: workerId,
      direction: 'from_worker',
      message_type: 'notification',
      content: message,
      status: 'pending',
      priority: priority
    }).select('id').single();
    
    return data?.id;
  } catch (err) {
    logger.error('notify failed', { error: err.message });
    return null;
  }
}

module.exports = {
  getSusanWorkerId,
  askCategoryQuestion,
  getPendingQuestions,
  processCategoryAnswer,
  notify
};
