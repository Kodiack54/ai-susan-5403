require('dotenv').config();
const { from } = require('./src/lib/db');

(async () => {
  // Get all Studios Platform children and add their paths
  const { data: children } = await from('dev_projects')
    .select('id, name, server_path')
    .eq('parent_id', '21bdd846-7b03-4879-b5ea-04263594da1e');

  for (const child of children || []) {
    if (!child.server_path) continue;

    // Check if path already exists
    const { data: existing } = await from('dev_project_paths')
      .select('id')
      .eq('project_id', child.id)
      .eq('path', child.server_path);

    if (!existing || existing.length === 0) {
      // Add the path
      await from('dev_project_paths').insert({
        project_id: child.id,
        path: child.server_path,
        path_type: 'folder'
      });
      console.log('Added:', child.server_path, '-> project:', child.name);
    } else {
      console.log('Exists:', child.server_path);
    }
  }

  // Also add local Windows path for kodiack-studio
  const { data: ks } = await from('dev_projects')
    .select('id')
    .ilike('name', '%Internal Claude%')
    .single();

  if (ks) {
    const windowsPath = 'C:\\Projects\\Studio\\kodiack-studio';
    const { data: existing } = await from('dev_project_paths')
      .select('id')
      .eq('path', windowsPath);

    if (!existing || existing.length === 0) {
      await from('dev_project_paths').insert({
        project_id: ks.id,
        path: windowsPath,
        path_type: 'local'
      });
      console.log('Added local Windows path for kodiack-studio');
    }
  }

  console.log('Done registering paths');
  process.exit(0);
})();
