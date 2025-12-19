// projectOrganizer.js - Susan's Dewey Decimal Style Project Organization
  const fs = require('fs').promises;
  const path = require('path');

  // Dewey Decimal Style Categories for Kodiack Studio
  const DEWEY_CATEGORIES = {
    '100': { name: 'ai-workers', desc: 'AI Workers & Agents' },
    '200': { name: 'services', desc: 'Backend Services & APIs' },
    '300': { name: 'frontend', desc: 'Frontend Applications' },
    '400': { name: 'shared', desc: 'Shared Libraries & Utils' },
    '500': { name: 'data', desc: 'Data & Database' },
    '600': { name: 'config', desc: 'Configuration & Environment' },
    '700': { name: 'docs', desc: 'Documentation' },
    '800': { name: 'scripts', desc: 'Scripts & Automation' },
    '900': { name: 'archive', desc: 'Archive & Legacy' }
  };

  // Standard folder structure for new projects
  const PROJECT_STRUCTURE = {
    'ai-worker': ['src', 'src/services', 'src/lib', 'src/routes', 'logs', 'data', 'planning', 'planning/concepts', 'planning/architecture'],
    'service': ['src', 'src/routes', 'src/middleware', 'src/utils', 'tests', 'planning'],
    'frontend': ['src', 'src/components', 'src/pages', 'src/hooks', 'src/utils', 'public', 'planning'],
    'planning-only': ['planning', 'planning/concepts', 'planning/architecture', 'planning/requirements', 'docs'],
    'default': ['src', 'src/lib', 'src/utils', 'docs', 'tests', 'planning']
  };

  class ProjectOrganizer {
    constructor() {
      this.basePath = '/var/www/NextBid_Dev';
      this.knownProjects = new Set();
    }

    async initialize() {
      console.log('[ProjectOrganizer] Initializing Dewey Decimal organization system...');
      await this.scanExistingProjects();
      this.startWatching();
    }

    async scanExistingProjects() {
      try {
        const entries = await fs.readdir(this.basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            this.knownProjects.add(entry.name);
          }
        }
        console.log(`[ProjectOrganizer] Found ${this.knownProjects.size} existing projects`);
      } catch (err) {
        console.error('[ProjectOrganizer] Error scanning projects:', err.message);
      }
    }

    detectProjectType(name) {
      if (name.includes('-') && /\d{4}$/.test(name)) {
        // Pattern: name-5401 = ai-worker
        return 'ai-worker';
      }
      if (name.includes('api') || name.includes('server') || name.includes('service')) {
        return 'service';
      }
      if (name.includes('ui') || name.includes('app') || name.includes('web') || name.includes('frontend')) {
        return 'frontend';
      }
      return 'default';
    }

    getDeweyCategory(projectType) {
      const mapping = {
        'ai-worker': '100',
        'service': '200',
        'frontend': '300',
        'default': '400'
      };
      return mapping[projectType] || '400';
    }

    async setupProjectStructure(projectPath, projectType) {
      const folders = PROJECT_STRUCTURE[projectType] || PROJECT_STRUCTURE['default'];

      for (const folder of folders) {
        const fullPath = path.join(projectPath, folder);
        try {
          await fs.mkdir(fullPath, { recursive: true });
          console.log(`[ProjectOrganizer] Created: ${folder}`);
        } catch (err) {
          if (err.code !== 'EEXIST') {
            console.error(`[ProjectOrganizer] Error creating ${folder}:`, err.message);
          }
        }
      }

      // Create README with Dewey classification
      const deweyCode = this.getDeweyCategory(projectType);
      const readme = `# ${path.basename(projectPath)}

  ## Dewey Classification: ${deweyCode} - ${DEWEY_CATEGORIES[deweyCode].desc}

  Project Type: ${projectType}
  Created: ${new Date().toISOString()}

  ## Structure
  ${folders.map(f => '- ' + f).join('\n')}
  `;

      try {
        const readmePath = path.join(projectPath, 'README.md');
        await fs.access(readmePath).catch(async () => {
          await fs.writeFile(readmePath, readme);
          console.log('[ProjectOrganizer] Created README.md with Dewey classification');
        });
      } catch (err) {
        // README already exists, skip
      }
    }

    async handleNewProject(projectName) {
      if (this.knownProjects.has(projectName)) return;

      console.log(`[ProjectOrganizer] New project detected: ${projectName}`);
      this.knownProjects.add(projectName);

      const projectPath = path.join(this.basePath, projectName);
      const projectType = this.detectProjectType(projectName);
      const deweyCode = this.getDeweyCategory(projectType);

      console.log(`[ProjectOrganizer] Classifying as ${deweyCode} (${projectType})`);
      await this.setupProjectStructure(projectPath, projectType);
    }


    /**
     * Create a new project folder from conversation detection
     * Called when Susan detects discussion about a new project
     */
    async createProject(projectName, options = {}) {
      const { projectType = 'planning-only', description = '', fromConversation = true } = options;
      
      if (this.knownProjects.has(projectName)) {
        console.log(`[ProjectOrganizer] Project already exists: ${projectName}`);
        return { exists: true, path: path.join(this.basePath, projectName) };
      }

      console.log(`[ProjectOrganizer] Creating new project from conversation: ${projectName}`);
      
      const projectPath = path.join(this.basePath, projectName);
      
      try {
        await fs.mkdir(projectPath, { recursive: true });
        await this.setupProjectStructure(projectPath, projectType);
        this.knownProjects.add(projectName);
        
        // Create initial planning doc
        if (fromConversation) {
          const planningDoc = `# ${projectName} - Planning Phase

Created: ${new Date().toISOString()}
Status: Planning/Concept
Source: Conversation Detection

## Description
${description || 'Project detected from conversation - needs requirements gathering.'}

## Concepts
- [ ] Define purpose and scope
- [ ] Identify dependencies
- [ ] Draft architecture

## Notes
_Add planning notes here as discussion continues..._
`;
          await fs.writeFile(path.join(projectPath, 'planning', 'README.md'), planningDoc);
        }
        
        console.log(`[ProjectOrganizer] Created project: ${projectName} (${projectType})`);
        return { created: true, path: projectPath, type: projectType };
      } catch (err) {
        console.error(`[ProjectOrganizer] Error creating project ${projectName}:`, err.message);
        return { error: err.message };
      }
    }

    /**
     * Get or create project - ensures project exists before filing knowledge
     */
    async ensureProject(projectName, options = {}) {
      if (this.knownProjects.has(projectName)) {
        return { exists: true, path: path.join(this.basePath, projectName) };
      }
      return await this.createProject(projectName, options);
    }

    startWatching() {
      // Check for new projects every 5 minutes
      setInterval(async () => {
        try {
          const entries = await fs.readdir(this.basePath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              if (!this.knownProjects.has(entry.name)) {
                await this.handleNewProject(entry.name);
              }
            }
          }
        } catch (err) {
          console.error('[ProjectOrganizer] Watch error:', err.message);
        }
      }, 5 * 60 * 1000);

      console.log('[ProjectOrganizer] Watching for new projects (5 min interval)');
    }
  }

  module.exports = new ProjectOrganizer();
