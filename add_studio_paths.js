require('dotenv').config();
const { from } = require('./src/lib/db');

const PATHS = [
  // Studio subfolders
  { path: 'C:\\Projects\\Studio\\kodiack-studio', projectName: '5400 - Internal Claude' },
  { path: 'C:/Projects/Studio/kodiack-studio', projectName: '5400 - Internal Claude' },
  { path: 'C:\\Projects\\Studio\\kodiack-dashboard-5500', projectName: '5500 - Kodiack Dashboard' },
  { path: 'C:/Projects/Studio/kodiack-dashboard-5500', projectName: '5500 - Kodiack Dashboard' },
  { path: 'C:\\Projects\\Studio\\ai-team', projectName: 'Studios Platform' },
  { path: 'C:/Projects/Studio/ai-team', projectName: 'Studios Platform' },
];

(async () => {
  const { data: projects } = await from('dev_projects').select('id, name');
  const pmap = {};
  for (const p of (projects || [])) pmap[p.name] = p.id;

  let added = 0;
  for (const item of PATHS) {
    const projectId = pmap[item.projectName];
    if (!projectId) {
      console.log('Project not found:', item.projectName);
      continue;
    }

    const { data: existing } = await from('dev_project_paths')
      .select('id')
      .eq('path', item.path)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('Already exists:', item.path);
      continue;
    }

    const { error } = await from('dev_project_paths').insert({
      project_id: projectId,
      path: item.path,
      path_type: 'local'
    });

    if (error) {
      console.log('Error:', item.path, error.message);
    } else {
      console.log('Added:', item.path, '->', item.projectName);
      added++;
    }
  }

  console.log('\nTotal added:', added);
  process.exit(0);
})();
