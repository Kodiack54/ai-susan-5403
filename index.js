/**
 * Susan - AI Librarian
 * Port 5403
 *
 * Catalogs knowledge, organizes conversations, provides Claude with
 * persistent memory across sessions. Tracks documentation, todos, and
 * project structures.
 */

require('dotenv').config();
const { Logger } = require('./src/lib/logger');

const logger = new Logger('Susan');

async function start() {
  logger.info('Starting Susan Librarian...');

  // 1. Load and validate config
  const config = require('./src/lib/config');
  logger.info('Config loaded', {
    port: config.PORT,
    chadUrl: config.CHAD_URL
  });

  // 2. Initialize knowledge service
  const knowledgeService = require('./src/services/knowledgeService');
  await knowledgeService.initialize();
  logger.info('Knowledge service initialized');
  // 3. Start cleaner service (30 min cleanup cycle)
  const cleanerService = require('./src/services/cleanerService');
  cleanerService.start();
  // 4. Start session detector (auto /start on new sessions)
  const sessionDetector = require('./src/services/sessionDetector');
  sessionDetector.start();
    // 5. Start project organizer (auto-create folders)
    const projectOrganizer = require('./src/services/projectOrganizer');
    await projectOrganizer.initialize();
    logger.info('Project organizer initialized (Dewey Decimal System)');

  // 6. Start extraction sorter (processes Chad's extractions)
  const extractionSorter = require('./src/services/extractionSorter');
  // DISABLED - using new validator
  // extractionSorter.startSorter();
  // 7. Start pipeline processor (flagged -> pending)
  const pipelineProcessor = require("./src/services/pipelineProcessor");
  pipelineProcessor.start();
  logger.info("Pipeline processor started (30s cycle)");
  logger.info('Extraction sorter started (30s cycle)');
  logger.info('Session detector started (auto /start)');
  logger.info('Cleaner service started (30 min cycle)');

  // 3. Discover catalogers
  const catalogerRegistry = require('./src/catalogers/registry');
  await catalogerRegistry.discover();
  logger.info(`Loaded ${catalogerRegistry.count()} catalogers`, {
    catalogers: catalogerRegistry.list().map(c => c.name)
  });

  // 4. Start HTTP server
  const app = require('./src/routes');
  const server = app.listen(config.PORT, () => {
    logger.info(`Susan HTTP server listening on port ${config.PORT}`);
  });

  // 5. Ready
  logger.info('Susan Librarian ready', {
    port: config.PORT,
    catalogers: catalogerRegistry.count(),
    pid: process.pid
  });

  printEndpoints(config.PORT);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down...');
    server.close(() => {
      logger.info('Susan shutdown complete');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down...');
    server.close(() => {
      logger.info('Susan shutdown complete');
      process.exit(0);
    });
  });
}

function printEndpoints(port) {
  console.log(`
====================================
  Susan - AI Team Librarian
  Port: ${port}
====================================

  HTTP API:  http://localhost:${port}

  Endpoints:
    GET  /health                       Health check

    Context:
    GET  /api/context?project=...      Claude startup context

    Messages (from Chad):
    POST /api/message                  Process message from Chad
    POST /api/summarize                Summarize ended session

    Knowledge:
    GET  /api/query?q=...              Search knowledge
    POST /api/remember                 Manually add knowledge
    GET  /api/knowledge/:id            Get specific item
    GET  /api/categories               List categories

    Documentation:
    GET  /api/docs?project=...         Get project docs
    POST /api/docs                     Create/update doc

    Todos:
    GET  /api/todos?project=...        Get todos
    POST /api/todo                     Add todo
    PATCH /api/todo/:id                Update todo
    GET  /api/todos/stats              Todo statistics

    Structures:
    GET  /api/structure?project=...    Get file structure
    POST /api/structure                Save structure
    POST /api/structure/port           Add port assignment
    POST /api/structure/service        Add service
    GET  /api/ports                    All port assignments

    Schemas:
    GET  /api/schemas                  Get stored schemas
    POST /api/schema                   Store table schema

    Decisions:
    GET  /api/decisions                Get decisions
    POST /api/decision                 Record decision

    Chat:
    POST /api/chat                     Chat with Susan

    Bugs (for Tiffany):
    GET  /api/bugs?project=...         Get bug reports
    POST /api/bug                      Report a bug
    PATCH /api/bug/:id                 Update bug
    DELETE /api/bug/:id                Delete bug

    Notes (Notepad):
    GET  /api/notes?project=...        Get notes
    POST /api/note                     Create note
    PATCH /api/note/:id                Update note
    DELETE /api/note/:id               Delete note

    Code Changes:
    GET  /api/code-changes?project=... Get commit log
    POST /api/code-change              Log a commit

    Tables:
    GET  /api/tables?prefix=...        List database tables
    GET  /api/table/:name/columns      Get table columns

    Files (Susan's Library):
    GET  /api/files?project_slug=...   List files
    POST /api/file                     Upload file (base64)
    DELETE /api/file                   Delete file
    POST /api/files/organize           Move file between categories
    GET  /api/files/categories         List filing categories
    GET  /api/files/stats              Library statistics

  Susan's Filing Categories:
    bugs/        - Bug screenshots and evidence
    docs/        - Documentation files, PDFs
    screenshots/ - UI captures, before/after
    assets/      - Logos, images, design files
    discoveries/ - Analysis findings
    exports/     - Data exports, reports
    misc/        - Everything else

  Ready to organize Claude's memory.
====================================
  `);
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

// Start Susan
start().catch(err => {
  logger.error('Startup failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ============================================
// NEW: VALIDATOR - Process flagged items to pending
// ============================================
const validator = require('./src/services/validator');

const VALIDATOR_INTERVAL = 30 * 1000; // 30 seconds

async function runValidator() {
  try {
    const result = await validator.process();
    if (result.validated > 0) {
      console.log('[Susan:Validator] Validated', result.validated, 'items');
    }
  } catch (err) {
    console.error('[Susan:Validator] Error:', err.message);
  }
}

// Start validator loop after a brief delay
setTimeout(() => {
  console.log('[Susan] Starting validator (30s interval)');
  setInterval(runValidator, VALIDATOR_INTERVAL);
  runValidator(); // Run immediately first time
}, 5000);

