/**
 * Quick Parse Route
 * Receives quick parse data from Chad every 5 minutes
 * Stores activity indicators without heavy AI processing
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:QuickParse');

/**
 * POST /api/quick-parse
 * Receive quick parse data from Chad
 */
router.post('/', async (req, res) => {
  try {
    const { sessionId, projectPath, quickData, parsedAt } = req.body;

    if (!sessionId || !projectPath) {
      return res.status(400).json({ error: 'Missing sessionId or projectPath' });
    }

    logger.info('Received quick parse', {
      sessionId,
      projectPath,
      keywords: quickData?.keywords?.length || 0,
      files: quickData?.fileMentions?.length || 0,
      todos: quickData?.todoMentions?.length || 0
    });

    // Store activity summary
    const { error: activityError } = await from('dev_ai_activity')
      .upsert({
        session_id: sessionId,
        project_path: projectPath,
        keywords: quickData.keywords || [],
        file_mentions: quickData.fileMentions || [],
        todo_mentions: quickData.todoMentions || [],
        error_mentions: quickData.errorMentions || [],
        message_count: quickData.messageCount || 0,
        last_activity: quickData.lastActivity,
        parsed_at: parsedAt,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'session_id'
      });

    if (activityError) {
      logger.warn('Failed to store activity', { error: activityError.message });
    }

    // If there are error mentions, create bug entries
    if (quickData.errorMentions?.length > 0) {
      for (const errorText of quickData.errorMentions.slice(0, 3)) {
        await from('dev_ai_bugs').insert({
          project_path: projectPath,
          title: errorText.substring(0, 100),
          description: errorText,
          severity: 'medium',
          status: 'open',
          source: 'quick-parse',
          created_at: new Date().toISOString()
        }).catch(() => {}); // Ignore duplicates
      }
    }

    // If there are todo mentions, create todo entries
    if (quickData.todoMentions?.length > 0) {
      for (const todoText of quickData.todoMentions.slice(0, 5)) {
        const existing = await from('dev_ai_todos')
          .select('id')
          .eq('project_path', projectPath)
          .ilike('title', `%${todoText.substring(0, 30)}%`)
          .limit(1);

        if (!existing.data?.length) {
          // Get routing from project path
          let routingInfo = {};
          const { data: pathInfo } = await from('dev_project_paths')
            .select('project_id')
            .eq('path', projectPath)
            .limit(1);
          if (pathInfo?.[0]?.project_id) {
            const { data: proj } = await from('dev_projects')
              .select('client_id, platform_id, id')
              .eq('id', pathInfo[0].project_id)
              .single();
            if (proj) {
              routingInfo = { client_id: proj.client_id, platform_id: proj.platform_id, project_id: proj.id };
            }
          }
          
          await from('dev_ai_todos').insert({
            project_path: projectPath,
            title: todoText.substring(0, 200),
            status: 'pending',
            priority: 'medium',
            source: 'quick-parse',
            created_at: new Date().toISOString(),
            client_id: routingInfo.client_id || null,
            platform_id: routingInfo.platform_id || null,
            project_id: routingInfo.project_id || null
          }).catch(() => {});
        }
      }
    }

    res.json({
      success: true,
      stored: {
        activity: !activityError,
        errors: quickData.errorMentions?.length || 0,
        todos: quickData.todoMentions?.length || 0
      }
    });
  } catch (err) {
    logger.error('Quick parse failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/quick-parse/recent
 * Get recent activity across projects
 */
router.get('/recent', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_activity')
      .select('*')
      .order('last_activity', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({ success: true, activity: data || [] });
  } catch (err) {
    logger.error('Failed to get recent activity', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
