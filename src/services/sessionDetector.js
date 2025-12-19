/**
 * Susan Session Detector
 * Monitors for new Claude sessions and auto-triggers /start
 * 
 * When Susan detects:
 * - Server Claude terminal starts/reconnects
 * - New session begins
 * 
 * She waits 20 seconds then sends /start to load context
 */

const WebSocket = require('ws');
const { Logger } = require('../lib/logger');

const logger = new Logger('Susan:SessionDetector');

const TERMINAL_SERVER = process.env.CLAUDE_SERVER_WS || 'ws://localhost:5400';
const STARTUP_DELAY_MS = 20000; // 20 seconds

let ws = null;
let reconnectTimer = null;
let startupTriggered = false;

/**
 * Start monitoring for new sessions
 */
function start() {
  logger.info('Session detector started', { terminalServer: TERMINAL_SERVER });
  connect();
}

/**
 * Connect to terminal server as monitor
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(`${TERMINAL_SERVER}?mode=monitor`);

    ws.on('open', () => {
      logger.info('Connected to terminal server as monitor');
      startupTriggered = false;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Detect new session or Claude ready
        if (msg.type === 'monitor_connected') {
          logger.info('Terminal monitor connected', { activeSessions: msg.activeSessions });
          
          if (msg.activeSessions > 0 && !startupTriggered) {
            scheduleStartCommand();
          }
        }
        
        // Detect Claude Code startup messages
        if (msg.type === 'monitor_output' && msg.data) {
          const output = msg.data.toString();
          
          // Look for Claude Code startup indicators
          if (!startupTriggered && (
            output.includes('What would you like') ||
            output.includes('How can I help') ||
            output.includes('Claude Code') ||
            output.includes('Opus') ||
            output.includes('session started')
          )) {
            logger.info('Detected Claude Code startup');
            scheduleStartCommand();
          }
        }
      } catch (err) {
        // Ignore parse errors
      }
    });

    ws.on('close', () => {
      logger.warn('Disconnected from terminal server, reconnecting...');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error('Terminal connection error', { error: err.message });
      scheduleReconnect();
    });

  } catch (err) {
    logger.error('Failed to connect to terminal server', { error: err.message });
    scheduleReconnect();
  }
}

/**
 * Schedule reconnection
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

/**
 * Schedule /start command after delay
 */
function scheduleStartCommand() {
  if (startupTriggered) return;
  startupTriggered = true;

  logger.info(`Scheduling /start command in ${STARTUP_DELAY_MS / 1000} seconds`);

  setTimeout(async () => {
    await sendStartCommand();
  }, STARTUP_DELAY_MS);
}

/**
 * Send /start command to terminal
 */
async function sendStartCommand() {
  try {
    // Method 1: Send via WebSocket if we have write access
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Try to send through the terminal server's input channel
      const startMessage = JSON.stringify({
        type: 'input',
        data: '/start\r'
      });
      
      // Note: As a monitor we might not have write access
      // This is a best-effort attempt
      logger.info('Attempting to send /start command');
    }

    // Method 2: Call the terminal server's REST API if available
    try {
      const response = await fetch('http://localhost:5411/api/send-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '/start' })
      });
      
      if (response.ok) {
        logger.info('/start command sent via REST API');
        return;
      }
    } catch {
      // REST API might not exist, that's ok
    }

    // Method 3: Notify via webhook or log for manual trigger
    logger.info('Auto /start: Please run /start to load session context', {
      reason: 'New Claude session detected',
      suggestion: 'Consider adding REST endpoint to terminal server for remote commands'
    });

  } catch (err) {
    logger.error('Failed to send /start command', { error: err.message });
  }
}

/**
 * Manually trigger /start (can be called from API)
 */
async function triggerStart() {
  startupTriggered = false;
  await sendStartCommand();
}

module.exports = {
  start,
  triggerStart
};
