/**
 * Susan Schema Routes
 * Store and retrieve database schemas
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Schemas');

/**
 * POST /api/schema - Store/update table schema
 */
router.post('/schema', async (req, res) => {
  const { databaseName, tableName, schema, description } = req.body;

  if (!databaseName || !tableName) {
    return res.status(400).json({ error: 'Database name and table name required' });
  }

  try {
    const { error } = await from('dev_ai_schemas')
      .upsert({
        database_name: databaseName,
        table_name: tableName,
        schema_definition: schema,
        description,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'database_name,table_name'
      });

    if (error) throw error;

    logger.info('Schema stored', { databaseName, tableName });
    res.json({ success: true });
  } catch (err) {
    logger.error('Schema store failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schemas - Get all schemas or filter by database
 */
router.get('/schemas', async (req, res) => {
  const { database } = req.query;

  try {
    let query = from('dev_ai_schemas')
      .select('database_name, table_name, schema_definition, description, updated_at')
      .order('database_name')
      .order('table_name');

    if (database) {
      query = query.eq('database_name', database);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    logger.error('Schema fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schema/:database/:table - Get specific schema
 */
router.get('/schema/:database/:table', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_schemas')
      .select('*')
      .eq('database_name', req.params.database)
      .eq('table_name', req.params.table)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) {
      return res.status(404).json({ error: 'Schema not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/schema/:database/:table - Delete schema
 */
router.delete('/schema/:database/:table', async (req, res) => {
  try {
    const { error } = await from('dev_ai_schemas')
      .delete()
      .eq('database_name', req.params.database)
      .eq('table_name', req.params.table);

    if (error) throw error;

    logger.info('Schema deleted', {
      database: req.params.database,
      table: req.params.table
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
