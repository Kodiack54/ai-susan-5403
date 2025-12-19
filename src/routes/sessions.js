const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');

/**
 * GET /api/sessions
 * Returns recent session logs with full content for briefing
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3;
    
    const { data, error } = await from('dev_ai_sessions')
      .select('id, started_at, ended_at, summary, raw_content')
      .order('started_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    res.json({ success: true, sessions: data || [] });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
