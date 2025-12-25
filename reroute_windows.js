/**
 * Reroute Windows paths to Linux paths
 */

require('dotenv').config();
const { from } = require('./src/lib/db');

// Windows to Linux path mapping
const PATH_MAP = {
  'C:\\Projects\\Studio\\kodiack-studio': '/var/www/Studio/kodiack-studio',
  'C:\\Projects\\Kodiack-Studio\\kodiack-dashboard-5500': '/var/www/Studio/kodiack-dashboard-5500',
  'C:\\Projects\\Studio\\kodiack-dashboard-5500': '/var/www/Studio/kodiack-dashboard-5500',
  'C:\\Projects\\Studio\\ai-team': '/var/www/Studio/ai-team',
  'C:\\Projects\\NextBid_Dev': '/var/www/NextBid_Dev',
  'C:\\Projects\\Premier_Group': '/var/www/Premier_Group'
};

async function loadProjectPaths() {
  const { data: paths } = await from('dev_project_paths').select('path, project_id');
  const { data: projects } = await from('dev_projects').select('id, name, client_id');

  const projectMap = {};
  for (const p of (projects || [])) projectMap[p.id] = p;

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
  pathLookup.sort((a, b) => b.path.length - a.path.length);
  return pathLookup;
}

function mapWindowsToLinux(winPath) {
  if (!winPath) return null;

  // Normalize to forward slashes for comparison
  const normalized = winPath.replace(/\\/g, '/');

  for (const [win, linux] of Object.entries(PATH_MAP)) {
    const winNorm = win.replace(/\\/g, '/');
    if (normalized.startsWith(winNorm)) {
      return normalized.replace(winNorm, linux);
    }
  }

  return null;
}

function findProjectForPath(linuxPath, pathLookup) {
  if (!linuxPath) return null;

  for (const p of pathLookup) {
    if (linuxPath === p.path || linuxPath.startsWith(p.path + '/') || linuxPath.startsWith(p.path)) {
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

  if (error || !items || items.length === 0) {
    console.log('No items to process');
    return { processed: 0, routed: 0 };
  }

  console.log('Found ' + items.length + ' items with NULL project_id');

  let routed = 0;
  let converted = 0;

  for (const item of items) {
    const itemPath = item[table.pathCol];
    if (!itemPath) continue;

    // Check if Windows path
    if (itemPath.includes('\\') || itemPath.startsWith('C:')) {
      const linuxPath = mapWindowsToLinux(itemPath);
      if (linuxPath) {
        converted++;
        const match = findProjectForPath(linuxPath, pathLookup);
        if (match) {
          const { error: updateError } = await from(table.name)
            .update({
              project_id: match.project_id,
              client_id: match.client_id,
              project_path: linuxPath  // Also update the path
            })
            .eq('id', item.id);

          if (!updateError) {
            routed++;
            if (routed <= 5 || routed % 50 === 0) {
              console.log('  ' + itemPath.substring(0, 40) + ' -> ' + match.project_name);
            }
          }
        }
      }
    }
  }

  console.log(table.name + ': Converted ' + converted + ', Routed ' + routed);
  return { processed: items.length, routed };
}

async function main() {
  console.log('Loading project paths...');
  const pathLookup = await loadProjectPaths();
  console.log('Loaded ' + pathLookup.length + ' project paths');

  let totalRouted = 0;

  for (const table of TABLES) {
    const result = await rerouteTable(table, pathLookup);
    totalRouted += result.routed;
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total routed: ' + totalRouted);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
