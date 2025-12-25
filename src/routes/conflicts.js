/**
 * Susan Conflicts Routes
 * Detect and manage knowledge conflicts
 *
 * When Susan finds new info that contradicts existing knowledge,
 * she flags it here for dev investigation - never overwrites without approval
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Conflicts');

/**
 * GET /api/conflicts - Get all pending conflicts
 */
router.get('/conflicts', async (req, res) => {
  const { project_id, status = 'pending', priority } = req.query;

  try {
    let query = from('dev_ai_conflicts')
      .select('*')
      .order('created_at', { ascending: false });

    if (project_id) {
      query = query.eq('project_id', project_id);
    }

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (priority) {
      query = query.eq('priority', priority);
    }

    const { data: conflicts, error } = await query;
    if (error) throw error;

    res.json({
      conflicts: conflicts || [],
      count: conflicts?.length || 0,
      message: conflicts?.length > 0
        ? 'Review these conflicts - Susan needs your help determining the truth'
        : 'No pending conflicts'
    });
  } catch (err) {
    logger.error('Get conflicts failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/conflicts/flag - Flag a new conflict
 * Called by Susan when she detects contradicting info
 */
router.post('/conflicts/flag', async (req, res) => {
  const {
    project_id,
    existing_table,
    existing_id,
    existing_content,
    existing_summary,
    new_content,
    new_source,
    conflict_type = 'contradiction',
    conflict_description,
    priority = 'medium'
  } = req.body;

  if (!existing_table || !existing_id || !new_content) {
    return res.status(400).json({
      error: 'Required: existing_table, existing_id, new_content'
    });
  }

  try {
    const { data: conflict, error } = await from('dev_ai_conflicts')
      .insert({
        project_id,
        existing_table,
        existing_id,
        existing_content,
        existing_summary,
        new_content,
        new_source,
        conflict_type,
        conflict_description,
        priority,
        status: 'pending',
        flagged_by: 'susan',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    logger.info('Conflict flagged for review', {
      conflictId: conflict.id,
      type: conflict_type,
      existingTable: existing_table,
      priority
    });

    // Create notification for dev
    await from('dev_ai_notifications')
      .insert({
        dev_id: 'assigned', // Will be resolved to actual dev
        project_id,
        notification_type: 'conflict',
        title: `Knowledge Conflict Detected: ${conflict_type}`,
        message: conflict_description || `New information contradicts existing ${existing_table} record`,
        related_table: 'dev_ai_conflicts',
        related_id: conflict.id,
        status: 'unread'
      });

    res.json({
      message: 'Conflict flagged - awaiting dev review',
      conflict,
      nextStep: 'Dev should review and call POST /api/conflicts/resolve'
    });
  } catch (err) {
    logger.error('Flag conflict failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/conflicts/resolve - Dev resolves a conflict
 */
router.post('/conflicts/resolve', async (req, res) => {
  const {
    conflict_id,
    dev_id,
    resolution,  // 'keep_existing', 'update', 'both_valid', 'dismiss'
    resolution_notes
  } = req.body;

  if (!conflict_id || !dev_id || !resolution) {
    return res.status(400).json({
      error: 'Required: conflict_id, dev_id, resolution'
    });
  }

  const validResolutions = ['keep_existing', 'update', 'both_valid', 'dismiss'];
  if (!validResolutions.includes(resolution)) {
    return res.status(400).json({
      error: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}`
    });
  }

  try {
    // Get the conflict
    const { data: conflict, error: fetchError } = await from('dev_ai_conflicts')
      .select('*')
      .eq('id', conflict_id)
      .single();

    if (fetchError || !conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    if (conflict.status !== 'pending') {
      return res.status(400).json({ error: `Conflict already ${conflict.status}` });
    }

    // Handle resolution
    let statusUpdate = `resolved_${resolution}`;
    let actionTaken = '';

    if (resolution === 'update') {
      // Update the existing record with new content
      await from(conflict.existing_table)
        .update({
          content: conflict.new_content,
          updated_at: new Date().toISOString()
        })
        .eq('id', conflict.existing_id);

      actionTaken = `Updated ${conflict.existing_table} record with new content`;
    } else if (resolution === 'both_valid') {
      // Add the new content as a separate record
      // This depends on the table structure - for knowledge table:
      if (conflict.existing_table === 'dev_ai_knowledge') {
        await from('dev_ai_knowledge')
          .insert({
            project_id: conflict.project_id,
            content: conflict.new_content,
            source: conflict.new_source || 'conflict_resolution',
            created_at: new Date().toISOString()
          });
        actionTaken = 'Created new knowledge record - both are valid';
      }
    } else if (resolution === 'keep_existing') {
      actionTaken = 'Kept existing record, discarded new content';
    } else {
      actionTaken = 'Conflict dismissed';
    }

    // Update conflict status
    await from('dev_ai_conflicts')
      .update({
        status: statusUpdate,
        resolution_notes: resolution_notes || actionTaken,
        resolved_by: dev_id,
        resolved_at: new Date().toISOString()
      })
      .eq('id', conflict_id);

    logger.info('Conflict resolved', {
      conflictId: conflict_id,
      resolution,
      resolvedBy: dev_id
    });

    res.json({
      message: 'Conflict resolved',
      conflictId: conflict_id,
      resolution,
      actionTaken,
      resolvedBy: dev_id
    });
  } catch (err) {
    logger.error('Resolve conflict failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conflicts/:id - Get a specific conflict with details
 */
router.get('/conflicts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: conflict, error } = await from('dev_ai_conflicts')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    // Also get the current state of the existing record
    let existingRecord = null;
    try {
      const { data } = await from(conflict.existing_table)
        .select('*')
        .eq('id', conflict.existing_id)
        .single();
      existingRecord = data;
    } catch (e) {
      // Record might have been deleted
    }

    res.json({
      conflict,
      existingRecord,
      comparison: {
        existingContent: conflict.existing_content,
        newContent: conflict.new_content
      }
    });
  } catch (err) {
    logger.error('Get conflict failed', { error: err.message, id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/notifications - Get notifications for a dev
 */
router.get('/notifications', async (req, res) => {
  const { dev_id, status = 'unread', limit = 50 } = req.query;

  try {
    let query = from('dev_ai_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (dev_id) {
      query = query.eq('dev_id', dev_id);
    }

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: notifications, error } = await query;
    if (error) throw error;

    res.json({
      notifications: notifications || [],
      count: notifications?.length || 0
    });
  } catch (err) {
    logger.error('Get notifications failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/read - Mark notifications as read
 */
router.post('/notifications/read', async (req, res) => {
  const { notification_ids, dev_id } = req.body;

  if (!notification_ids || !Array.isArray(notification_ids)) {
    return res.status(400).json({ error: 'notification_ids array required' });
  }

  try {
    await from('dev_ai_notifications')
      .update({
        status: 'read',
        read_at: new Date().toISOString()
      })
      .in('id', notification_ids);

    res.json({
      message: 'Notifications marked as read',
      count: notification_ids.length
    });
  } catch (err) {
    logger.error('Mark notifications read failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
