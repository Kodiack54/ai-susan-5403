require('dotenv').config();
const { from } = require('./src/lib/db');

(async () => {
  const { data: projects } = await from('dev_projects')
    .select('id, name')
    .ilike('name', '%nextbid%');

  console.log('NextBid projects and their paths:\n');
  for (const p of (projects || [])) {
    const { data: paths } = await from('dev_project_paths')
      .select('path')
      .eq('project_id', p.id);
    console.log(p.name + ':');
    if (paths && paths.length > 0) {
      for (const path of paths) {
        console.log('  ' + path.path);
      }
    } else {
      console.log('  (no paths registered!)');
    }
  }
  process.exit(0);
})();
