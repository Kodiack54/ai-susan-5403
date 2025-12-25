/**
 * Susan File Structure Routes
 * Track and manage project file structures
 */

const express = require('express');
const router = express.Router();
const { from } = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:Structures');

/**
 * POST /api/structure - Store/update file structure
 */
router.post('/structure', async (req, res) => {
  const { projectPath, structure, description, ports, services } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: 'Project path required' });
  }

  try {
    const { data, error } = await from('dev_ai_structures')
      .upsert({
        project_id: projectPath,
        structure: structure || {},
        description,
        ports: ports || [],
        services: services || [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_id'
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Structure updated', { projectPath });
    res.json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Structure update failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/structure - Get file structure for a project
 */
router.get('/structure', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project parameter required' });
  }

  try {
    const { data, error } = await from('dev_ai_structures')
      .select('*')
      .eq('project_id', project)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) {
      return res.status(404).json({ error: 'Structure not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/structures - Get all tracked structures
 */
router.get('/structures', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_structures')
      .select('project_id, description, ports, services, updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/structure/port - Add port assignment to structure
 */
router.post('/structure/port', async (req, res) => {
  const { projectPath, port, service, description } = req.body;

  if (!projectPath || !port || !service) {
    return res.status(400).json({ error: 'projectPath, port, and service required' });
  }

  try {
    // Get existing structure
    const { data: existing } = await from('dev_ai_structures')
      .select('ports')
      .eq('project_id', projectPath)
      .single();

    const ports = existing?.ports || [];

    // Check if port already exists
    const existingIdx = ports.findIndex(p => p.port === port);
    if (existingIdx >= 0) {
      ports[existingIdx] = { port, service, description };
    } else {
      ports.push({ port, service, description });
    }

    // Upsert
    const { error } = await from('dev_ai_structures')
      .upsert({
        project_id: projectPath,
        ports,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_id'
      });

    if (error) throw error;

    logger.info('Port added to structure', { projectPath, port, service });
    res.json({ success: true });
  } catch (err) {
    logger.error('Port add failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/structure/service - Add service to structure
 */
router.post('/structure/service', async (req, res) => {
  const { projectPath, name, type, path, port, description } = req.body;

  if (!projectPath || !name) {
    return res.status(400).json({ error: 'projectPath and name required' });
  }

  try {
    // Get existing structure
    const { data: existing } = await from('dev_ai_structures')
      .select('services')
      .eq('project_id', projectPath)
      .single();

    const services = existing?.services || [];

    // Check if service already exists
    const existingIdx = services.findIndex(s => s.name === name);
    const serviceData = { name, type, path, port, description };

    if (existingIdx >= 0) {
      services[existingIdx] = serviceData;
    } else {
      services.push(serviceData);
    }

    // Upsert
    const { error } = await from('dev_ai_structures')
      .upsert({
        project_id: projectPath,
        services,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_id'
      });

    if (error) throw error;

    logger.info('Service added to structure', { projectPath, name });
    res.json({ success: true });
  } catch (err) {
    logger.error('Service add failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ports - Get all port assignments across projects
 */
router.get('/ports', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_structures')
      .select('project_id, ports');

    if (error) throw error;

    // Flatten all ports
    const allPorts = [];
    (data || []).forEach(project => {
      (project.ports || []).forEach(port => {
        allPorts.push({
          ...port,
          projectPath: project.project_id
        });
      });
    });

    // Sort by port number
    allPorts.sort((a, b) => a.port - b.port);

    res.json(allPorts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// Structure Items - Individual file/folder tracking
// For Tiffany to navigate and find bugs
// ========================================

/**
 * GET /api/structures - Get structure items for a project
 * (Note: This overrides the old /structures endpoint)
 */
router.get('/structures', async (req, res) => {
  const { project } = req.query;

  try {
    let query = from('dev_ai_structure_items')
      .select('*')
      .order('path', { ascending: true });

    if (project) {
      query = query.eq('project_id', project);
    }

    const { data, error } = await query;

    if (error) {
      // Table might not exist yet, return empty
      if (error.code === '42P01') {
        return res.json({ success: true, structures: [] });
      }
      throw error;
    }

    res.json({ success: true, structures: data || [] });
  } catch (err) {
    logger.error('Structures fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/structure - Add a structure item (file or folder)
 */
router.post('/structure', async (req, res) => {
  const {
    project_id, projectPath,
    path, name, type,
    status, purpose, notes,
    parent_path
  } = req.body;

  const projPath = project_id || projectPath;

  if (!projPath || !path || !name) {
    return res.status(400).json({ error: 'project_id, path, and name required' });
  }

  try {
    const { data, error } = await from('dev_ai_structure_items')
      .insert({
        project_id: projPath,
        path,
        name,
        type: type || 'file',
        status: status || 'active',
        purpose,
        notes,
        parent_path
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Structure item added', { path, type, status });
    res.json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Structure item add failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/structure/:id - Get a specific structure item
 */
router.get('/structure/:id', async (req, res) => {
  try {
    const { data, error } = await from('dev_ai_structure_items')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.json({ success: true, item: data });
  } catch (err) {
    logger.error('Structure item fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/structure/:id - Update a structure item
 */
router.patch('/structure/:id', async (req, res) => {
  const { path, name, type, status, purpose, notes, parent_path } = req.body;

  try {
    const updates = { updated_at: new Date().toISOString() };

    if (path !== undefined) updates.path = path;
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (status !== undefined) updates.status = status;
    if (purpose !== undefined) updates.purpose = purpose;
    if (notes !== undefined) updates.notes = notes;
    if (parent_path !== undefined) updates.parent_path = parent_path;

    const { error } = await from('dev_ai_structure_items')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw error;

    logger.info('Structure item updated', { id: req.params.id, status });
    res.json({ success: true });
  } catch (err) {
    logger.error('Structure item update failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/structure/:id - Delete a structure item
 */
router.delete('/structure/:id', async (req, res) => {
  try {
    const { error } = await from('dev_ai_structure_items')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    logger.info('Structure item deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Structure item delete failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
