require('dotenv').config();
const { from } = require('./src/lib/db');

const WINDOWS_PATHS = [
  { windows: 'C:\\Projects\\NextBid_Core', projectName: 'NextBid Core' },
  { windows: 'C:\\Projects\\NextBid_Engine', projectName: 'NextBid Engine' },
  { windows: 'C:\\Projects\\NextBid_Portals', projectName: 'NextBid Portal' },
  { windows: 'C:\\Projects\\NextBidder', projectName: 'NextBidder' },
  { windows: 'C:\\Projects\\NextSource', projectName: 'NextBid Sources' },
  { windows: 'C:\\Projects\\NextTask', projectName: 'NextTask' },
  { windows: 'C:\\Projects\\NextTech', projectName: 'NextTech' },
  { windows: 'C:\\Projects\\Studio', projectName: 'Studios Platform' },
  // Also add forward-slash versions
  { windows: 'C:/Projects/NextBid_Core', projectName: 'NextBid Core' },
  { windows: 'C:/Projects/NextBid_Engine', projectName: 'NextBid Engine' },
  { windows: 'C:/Projects/NextBid_Portals', projectName: 'NextBid Portal' },
  { windows: 'C:/Projects/NextBidder', projectName: 'NextBidder' },
  { windows: 'C:/Projects/NextSource', projectName: 'NextBid Sources' },
  { windows: 'C:/Projects/NextTask', projectName: 'NextTask' },
  { windows: 'C:/Projects/NextTech', projectName: 'NextTech' },
  { windows: 'C:/Projects/Studio', projectName: 'Studios Platform' },
];

(async () => {
  // Get all projects
  const { data: projects } = await from('dev_projects').select('id, name');
  const projectMap = {};
  for (const p of (projects || [])) {
    projectMap[p.name] = p.id;
  }

  console.log('Adding Windows paths to dev_project_paths:\n');

  let added = 0;
  for (const mapping of WINDOWS_PATHS) {
    const projectId = projectMap[mapping.projectName];
    if (!projectId) {
      console.log('Project not found:', mapping.projectName);
      continue;
    }

    // Check if path already exists
    const { data: existing } = await from('dev_project_paths')
      .select('id')
      .eq('path', mapping.windows)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('Already exists:', mapping.windows);
      continue;
    }

    // Add the path
    const { error } = await from('dev_project_paths').insert({
      project_id: projectId,
      path: mapping.windows,
      path_type: 'local'
    });

    if (error) {
      console.log('Error adding', mapping.windows, ':', error.message);
    } else {
      console.log('Added:', mapping.windows, '->', mapping.projectName);
      added++;
    }
  }

  console.log('\nTotal added:', added);
  process.exit(0);
})();
