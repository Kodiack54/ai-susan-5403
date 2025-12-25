require('dotenv').config();
const { from } = require('./src/lib/db');

(async () => {
  // Find items that mention NextBid
  const { data } = await from('dev_ai_knowledge')
    .select('id, title, content, project_id')
    .ilike('content', '%nextbid%')
    .limit(30);

  // Get NextBid project IDs
  const { data: projects } = await from('dev_projects')
    .select('id, name')
    .ilike('name', '%nextbid%');

  const nextbidIds = new Set((projects || []).map(p => p.id));
  console.log('NextBid projects:', projects?.map(p => p.name));

  // Get project names for items
  const allProjectIds = [...new Set((data || []).map(d => d.project_id).filter(Boolean))];
  const { data: allProjects } = await from('dev_projects')
    .select('id, name')
    .in('id', allProjectIds);
  const projectMap = {};
  for (const p of (allProjects || [])) projectMap[p.id] = p.name;

  let correctlyRouted = 0;
  let misrouted = 0;

  for (const item of (data || [])) {
    if (nextbidIds.has(item.project_id)) {
      correctlyRouted++;
    } else {
      misrouted++;
      if (misrouted <= 5) {
        console.log('\nShould be NextBid but is:', projectMap[item.project_id] || item.project_id || 'NULL');
        console.log('  Title:', (item.title || '').substring(0, 80));
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log('Items mentioning NextBid:', data?.length);
  console.log('Correctly in NextBid projects:', correctlyRouted);
  console.log('In other projects:', misrouted);

  process.exit(0);
})();
