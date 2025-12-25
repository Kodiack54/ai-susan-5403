/**
 * Reroute NULL project_id items using path prefix matching
 * Matches /var/www/Studio/ai-team/ai-susan-5403/src/services to /var/www/Studio/ai-team/ai-susan-5403
 */

require('dotenv').config();
const { from } = require('./src/lib/db');

async function loadProjectPaths() {
  // Get all project paths with their project info
  const { data: paths } = await from('dev_project_paths')
    .select('path, project_id');

  const { data: projects } = await from('dev_projects')
    .select('id, name, client_id');

  const projectMap = {};
  for (const p of (projects || [])) {
    projectMap[p.id] = p;
  }

  // Build path lookup sorted by length (longest first for best match)
  const pathLookup = [];
  for (const p of (paths || [])) {
    if (p.path && p.project_id && projectMap[p.project_id]) {
      pathLookup.push({
        path: p.path,
        project_id: p.project_id,
        project_name: projectMap[p.project_id].name,
        client_id: projectMap[p.project_id].client_id
      });
    }
  }

  // Sort by path length descending (more specific paths first)
  pathLookup.sort((a, b) => b.path.length - a.path.length);

  return pathLookup;
}

function findProjectForPath(itemPath, pathLookup) {
  if (!itemPath) return null;

  // Normalize path
  const normalizedPath = itemPath.replace(/\\/g, '/');

  // Try exact match first
  for (const p of pathLookup) {
    if (normalizedPath === p.path) {
      return p;
    }
  }

  // Try prefix match (item path starts with project path)
  for (const p of pathLookup) {
    if (normalizedPath.startsWith(p.path + '/') || normalizedPath.startsWith(p.path)) {
      return p;
    }
  }

  return null;
}

const TABLES = [
  { name: 'dev_ai_knowledge', pathCol: 'project_path' },
  { name: 'dev_ai_todos', pathCol: 'project_path' },
  { name: 'dev_ai_bugs', pathCol: 'project_path' },
  { name: 'dev_ai_decisions', pathCol: 'project_path' }
];

async function rerouteTable(table, pathLookup) {
  console.log('\n=== Processing ' + table.name + ' ===');

  const { data: items, error } = await from(table.name)
    .select('id, ' + table.pathCol)
    .is('project_id', null)
    .limit(2000);

  if (error) {
    console.log('Error:', error.message);
    return { processed: 0, routed: 0 };
  }

  if (!items || items.length === 0) {
    console.log('No items to process');
    return { processed: 0, routed: 0 };
  }

  console.log('Found ' + items.length + ' items with paths but no project_id');

  let routed = 0;
  let errors = 0;

  for (const item of items) {
    const itemPath = item[table.pathCol];
    const match = findProjectForPath(itemPath, pathLookup);

    if (match) {
      const { error: updateError } = await from(table.name)
        .update({
          project_id: match.project_id,
          client_id: match.client_id
        })
        .eq('id', item.id);

      if (updateError) {
        errors++;
      } else {
        routed++;
        if (routed <= 5 || routed % 100 === 0) {
          console.log('  ' + itemPath.substring(0, 50) + '... -> ' + match.project_name);
        }
      }
    }
  }

  console.log(table.name + ': Processed ' + items.length + ', Routed ' + routed);
  return { processed: items.length, routed };
}

async function main() {
  console.log('Loading project paths...');
  const pathLookup = await loadProjectPaths();
  console.log('Loaded ' + pathLookup.length + ' project paths');

  console.log('\nPaths available:');
  for (const p of pathLookup.slice(0, 10)) {
    console.log('  ' + p.path + ' -> ' + p.project_name);
  }

  let totalProcessed = 0;
  let totalRouted = 0;

  for (const table of TABLES) {
    const result = await rerouteTable(table, pathLookup);
    totalProcessed += result.processed;
    totalRouted += result.routed;
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total processed: ' + totalProcessed);
  console.log('Total routed: ' + totalRouted);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
