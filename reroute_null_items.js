/**
 * Reroute NULL project_id items using projectDetector
 * Scans knowledge, todos, bugs, decisions tables
 */

require('dotenv').config();
const { from } = require('./src/lib/db');
const projectDetector = require('./src/services/projectDetector');

const TABLES = [
  { name: 'dev_ai_knowledge', contentCol: 'content', titleCol: 'title' },
  { name: 'dev_ai_todos', contentCol: 'description', titleCol: 'title' },
  { name: 'dev_ai_bugs', contentCol: 'description', titleCol: 'title' },
  { name: 'dev_ai_decisions', contentCol: 'description', titleCol: 'title' }
];

const MIN_CONFIDENCE = 0.2;

async function rerouteTable(table) {
  console.log(`\n=== Processing ${table.name} ===`);

  // Get items with NULL project_id
  const { data: items, error } = await from(table.name)
    .select(`id, ${table.titleCol}, ${table.contentCol}`)
    .is('project_id', null)
    .limit(500);

  if (error) {
    console.log(`Error fetching from ${table.name}:`, error.message);
    return { processed: 0, routed: 0, errors: 1 };
  }

  if (!items || items.length === 0) {
    console.log(`No NULL items in ${table.name}`);
    return { processed: 0, routed: 0, errors: 0 };
  }

  console.log(`Found ${items.length} items with NULL project_id`);

  let routed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      // Combine title and content for detection
      const content = `${item[table.titleCol] || ''} ${item[table.contentCol] || ''}`;

      if (!content.trim()) continue;

      const detected = await projectDetector.detectProject(content);

      if (detected && detected.project_id && detected.confidence >= MIN_CONFIDENCE) {
        // Update the item
        const { error: updateError } = await from(table.name)
          .update({
            project_id: detected.project_id,
            client_id: detected.client_id || null,
            project_path: detected.server_path
          })
          .eq('id', item.id);

        if (updateError) {
          console.log(`Error updating ${item.id}:`, updateError.message);
          errors++;
        } else {
          routed++;
          if (routed <= 5 || routed % 50 === 0) {
            console.log(`  Routed to ${detected.project_name} (${detected.confidence.toFixed(2)}): ${item[table.titleCol]?.substring(0, 50)}...`);
          }
        }
      }
    } catch (err) {
      console.log(`Error processing ${item.id}:`, err.message);
      errors++;
    }
  }

  console.log(`${table.name}: Processed ${items.length}, Routed ${routed}, Errors ${errors}`);
  return { processed: items.length, routed, errors };
}

async function main() {
  console.log('Starting reroute of NULL project_id items...');
  console.log(`Minimum confidence threshold: ${MIN_CONFIDENCE}`);

  let totalProcessed = 0;
  let totalRouted = 0;
  let totalErrors = 0;

  for (const table of TABLES) {
    const result = await rerouteTable(table);
    totalProcessed += result.processed;
    totalRouted += result.routed;
    totalErrors += result.errors;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total routed: ${totalRouted}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Still NULL: ${totalProcessed - totalRouted}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
