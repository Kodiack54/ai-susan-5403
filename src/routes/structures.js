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
        project_path: projectPath,
        structure: structure || {},
        description,
        ports: ports || [],
        services: services || [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_path'
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
      .eq('project_path', project)
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
      .select('project_path, description, ports, services, updated_at')
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
      .eq('project_path', projectPath)
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
        project_path: projectPath,
        ports,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_path'
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
      .eq('project_path', projectPath)
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
        project_path: projectPath,
        services,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_path'
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
      .select('project_path, ports');

    if (error) throw error;

    // Flatten all ports
    const allPorts = [];
    (data || []).forEach(project => {
      (project.ports || []).forEach(port => {
        allPorts.push({
          ...port,
          projectPath: project.project_path
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

module.exports = router;
