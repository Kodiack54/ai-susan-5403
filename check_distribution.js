require('dotenv').config();
const { from } = require('./src/lib/db');

(async () => {
  const { data } = await from('dev_ai_knowledge').select('project_id');

  const counts = {};
  for (const item of (data || [])) {
    const id = item.project_id || 'NULL';
    counts[id] = (counts[id] || 0) + 1;
  }

  const ids = Object.keys(counts).filter(id => id !== 'NULL');
  const { data: projects } = await from('dev_projects')
    .select('id, name, parent_id')
    .in('id', ids);

  const projectMap = {};
  for (const p of (projects || [])) projectMap[p.id] = p;

  console.log('Knowledge items by project:');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [id, count] of sorted.slice(0, 20)) {
    const proj = projectMap[id];
    const name = proj ? proj.name : (id === 'NULL' ? 'NULL' : 'Unknown');
    const parentId = proj?.parent_id || '';
    console.log(`${count} - ${name} ${parentId ? '(child of ' + parentId + ')' : ''}`);
  }

  // Check Studios Platform specifically
  const studiosId = '21bdd846-7b03-4879-b5ea-04263594da1e';
  console.log('\nStudios Platform ID:', studiosId);
  console.log('Items with Studios Platform ID:', counts[studiosId] || 0);

  process.exit(0);
})();
