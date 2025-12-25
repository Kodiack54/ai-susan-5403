require('dotenv').config();
const { from } = require('./src/lib/db');
const projectDetector = require('./src/services/projectDetector');

(async () => {
  // Get items mentioning NextBid that aren't in NextBid projects
  const { data } = await from('dev_ai_knowledge')
    .select('id, title, content, project_id')
    .ilike('content', '%nextbid%')
    .limit(10);

  // Get NextBid project IDs
  const { data: projects } = await from('dev_projects')
    .select('id, name')
    .ilike('name', '%nextbid%');
  const nextbidIds = new Set((projects || []).map(p => p.id));

  console.log('Testing projectDetector on NextBid-mentioning items:\n');

  for (const item of (data || [])) {
    if (!nextbidIds.has(item.project_id)) {
      const detected = await projectDetector.detectProject(item.content || '');
      console.log('---');
      console.log('Title:', (item.title || '').substring(0, 60));
      console.log('Current project_id:', item.project_id || 'NULL');
      console.log('Detected:', detected?.project_name, '(confidence:', detected?.confidence?.toFixed(2) + ')');
      console.log('Reason:', detected?.reason);
    }
  }

  process.exit(0);
})();
