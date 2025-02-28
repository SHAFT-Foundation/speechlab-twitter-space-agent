#!/usr/bin/env node

/**
 * Multi-Space Capture
 * 
 * This script allows capturing multiple Twitter Spaces simultaneously,
 * each sending audio to a different WebSocket endpoint.
 */

require('dotenv').config();
const { Command } = require('commander');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./src/utils/logger');
const { discoverTwitterSpaces } = require('./src/browser/spaces-discovery');

// Configure CLI
const program = new Command();
program
  .name('multi-space-capture')
  .description('Capture audio from multiple Twitter Spaces simultaneously')
  .version('1.0.0')
  .option('-u, --urls <urls>', 'Comma-separated list of Twitter Space URLs to capture')
  .option('-c, --count <count>', 'Number of top spaces to capture if no URLs provided', '3')
  .option('-d, --debug', 'Enable debug logging')
  .option('-h, --headless', 'Run in headless mode', false)
  .option('-b, --base-port <port>', 'Base WebSocket server port (will increment for each space)', '8080')
  .option('-w, --websocket-urls <urls>', 'Comma-separated list of WebSocket URLs to send audio to')
  .option('-e, --websocket-base <url>', 'Base WebSocket URL (will be appended with space index)', 'wss://localryan.ngrok.app/meeting/wuw-vfud-cre/audio')
  .parse(process.argv);

const options = program.opts();

// Configure logging
logger.level = options.debug ? 'debug' : (process.env.LOG_LEVEL || 'info');

// Global variables
const captureProcesses = new Map();
const serverProcesses = new Map();

/**
 * Start a WebSocket server on a specific port
 * @param {number} port - Port to start the server on
 * @returns {Promise<Object>} Server process information
 */
function startWebSocketServer(port) {
  return new Promise((resolve, reject) => {
    logger.info(`Starting WebSocket server on port ${port}...`);
    
    // First check if the port is already in use
    const net = require('net');
    
    const tester = net.createServer()
      .once('error', err => {
        if (err.code === 'EADDRINUSE') {
          logger.error(`Port ${port} is already in use`);
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      })
      .once('listening', () => {
        // Port is free, close the tester and start the actual server
        tester.close(() => {
          // Start the WebSocket server with a custom port
          const serverProcess = spawn('node', [
            path.join(__dirname, 'test-server.js'),
            '--port', port.toString()
          ], {
            detached: true,
            stdio: 'pipe' // Capture output
          });
          
          // Handle server output
          let serverOutput = '';
          serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            console.log(`[WebSocket Server ${port}] ${output.trim()}`);
            
            // Check if server is ready
            if (output.includes(`WebSocket server started on port ${port}`)) {
              logger.info(`WebSocket server started successfully on port ${port}`);
              resolve({
                process: serverProcess,
                pid: serverProcess.pid,
                port: port
              });
            }
          });
          
          // Handle server errors
          serverProcess.stderr.on('data', (data) => {
            const errorOutput = data.toString();
            console.error(`[WebSocket Server ${port} Error] ${errorOutput.trim()}`);
            logger.error(`WebSocket server error on port ${port}: ${errorOutput}`);
          });
          
          // Handle process errors
          serverProcess.on('error', (error) => {
            logger.error(`Failed to start WebSocket server on port ${port}: ${error.message}`);
            reject(error);
          });
          
          // Set a timeout for server startup
          setTimeout(() => {
            if (serverOutput.includes(`WebSocket server started on port ${port}`)) {
              return; // Already resolved
            }
            logger.error(`WebSocket server on port ${port} failed to start within timeout period`);
            reject(new Error(`WebSocket server startup timeout on port ${port}`));
          }, 10000);
        });
      })
      .listen(port);
  });
}

/**
 * Start capturing a Twitter Space
 * @param {string} spaceUrl - Twitter Space URL
 * @param {number} port - WebSocket server port
 * @param {boolean} headless - Whether to run in headless mode
 * @param {string} websocketUrl - WebSocket URL to send audio to
 * @param {number} index - Index of the space in the list
 * @returns {Promise<Object>} Capture process information
 */
async function startCapturingSpace(spaceUrl, port, headless, websocketUrl, index) {
  // Create a unique ID for this capture
  const captureId = `space-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  logger.info(`Starting capture of Twitter Space: ${spaceUrl}`);
  logger.info(`WebSocket port: ${port}`);
  logger.info(`WebSocket URL: ${websocketUrl}`);
  logger.info(`Headless mode: ${headless ? 'Enabled' : 'Disabled'}`);
  
  // Build the command arguments
  const args = [
    './capture-space.js',
    '--url', spaceUrl,
    '--port', port.toString()
  ];
  
  // Add WebSocket URL if provided
  if (websocketUrl) {
    args.push('--websocket', websocketUrl);
  }
  
  // Add debug flag if needed
  if (options.debug) {
    args.push('--debug');
  }
  
  // Add headless flag if needed
  if (headless) {
    args.push('--headless');
  }
  
  // Start the capture process
  const captureProcess = spawn('node', args, {
    stdio: 'pipe' // Capture output
  });
  
  // Handle process output
  captureProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Capture ${captureId}] ${output.trim()}`);
  });
  
  captureProcess.stderr.on('data', (data) => {
    const errorOutput = data.toString();
    console.error(`[Capture ${captureId} Error] ${errorOutput.trim()}`);
  });
  
  logger.info(`Capture process started with PID: ${captureProcess.pid}`);
  
  // Handle process events
  captureProcess.on('exit', (code, signal) => {
    logger.info(`Capture process ${captureId} exited with code ${code} and signal ${signal}`);
    captureProcesses.delete(captureId);
  });
  
  captureProcess.on('error', (error) => {
    logger.error(`Capture process ${captureId} error: ${error.message}`);
  });
  
  // Store the process
  captureProcesses.set(captureId, {
    process: captureProcess,
    pid: captureProcess.pid,
    url: spaceUrl,
    port: port,
    id: captureId
  });
  
  return {
    id: captureId,
    process: captureProcess,
    pid: captureProcess.pid,
    url: spaceUrl,
    port: port
  };
}

/**
 * Setup shutdown handler
 */
function setupShutdownHandler() {
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal. Starting cleanup...');
    await cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal. Starting cleanup...');
    await cleanup();
    process.exit(0);
  });
}

/**
 * Cleanup resources before exit
 */
async function cleanup() {
  logger.info('Cleaning up resources...');
  
  // Kill all capture processes
  for (const [id, captureInfo] of captureProcesses.entries()) {
    logger.info(`Killing capture process ${id} (PID: ${captureInfo.pid})...`);
    try {
      process.kill(captureInfo.pid);
    } catch (error) {
      logger.error(`Failed to kill capture process ${id}: ${error.message}`);
    }
  }
  
  // Kill all server processes
  for (const [port, serverInfo] of serverProcesses.entries()) {
    logger.info(`Killing WebSocket server on port ${port} (PID: ${serverInfo.pid})...`);
    try {
      process.kill(serverInfo.pid);
    } catch (error) {
      logger.error(`Failed to kill WebSocket server on port ${port}: ${error.message}`);
    }
  }
  
  logger.info('Cleanup complete.');
}

/**
 * Main function
 */
async function main() {
  logger.info('Multi-Space Capture Tool');
  logger.info('-------------------------');
  logger.info(`Debug mode: ${options.debug ? 'enabled' : 'disabled'}`);
  logger.info(`Headless mode: ${options.headless ? 'enabled' : 'disabled'}`);
  logger.info(`Base WebSocket port: ${options.basePort}`);
  
  if (options.websocketUrls) {
    logger.info(`Using provided WebSocket URLs: ${options.websocketUrls}`);
  } else if (options.websocketBase) {
    logger.info(`Using base WebSocket URL: ${options.websocketBase}`);
  }
  
  // Setup shutdown handler
  setupShutdownHandler();
  
  try {
    // Parse URLs or discover spaces
    let spaceUrls = [];
    
    if (options.urls) {
      // Use provided URLs
      spaceUrls = options.urls.split(',').map(url => url.trim());
      logger.info(`Using ${spaceUrls.length} provided Twitter Space URLs`);
    } else {
      // Discover spaces
      const count = parseInt(options.count, 10);
      logger.info(`Discovering top ${count} Twitter Spaces...`);
      
      const spaces = await discoverTwitterSpaces({ limit: count * 2 }); // Get more than needed in case some are invalid
      
      if (!spaces || spaces.length === 0) {
        throw new Error('No Twitter Spaces found');
      }
      
      // Take the top spaces up to the requested count
      spaceUrls = spaces.slice(0, count).map(space => space.url);
      
      logger.info(`Discovered ${spaceUrls.length} Twitter Spaces`);
      spaces.forEach((space, index) => {
        if (index < count) {
          logger.info(`Space ${index + 1}: ${space.title || 'Untitled'} - ${space.url}`);
        }
      });
    }
    
    // Parse WebSocket URLs if provided
    let websocketUrls = [];
    if (options.websocketUrls) {
      websocketUrls = options.websocketUrls.split(',').map(url => url.trim());
      logger.info(`Using ${websocketUrls.length} provided WebSocket URLs`);
    }
    
    // Start WebSocket servers for each space
    const basePort = parseInt(options.basePort, 10);
    
    for (let i = 0; i < spaceUrls.length; i++) {
      const port = basePort + i;
      const url = spaceUrls[i];
      
      // Determine WebSocket URL for this space
      let websocketUrl;
      if (websocketUrls.length > i) {
        // Use provided WebSocket URL for this index
        websocketUrl = websocketUrls[i];
      } else if (options.websocketBase) {
        // Append index to base WebSocket URL
        websocketUrl = `${options.websocketBase}${i + 1}`;
      }
      
      try {
        // Only start WebSocket server if we're using localhost
        let serverInfo = null;
        if (!websocketUrl || websocketUrl.includes('localhost')) {
          // Start WebSocket server
          logger.info(`Starting WebSocket server ${i + 1} on port ${port}...`);
          serverInfo = await startWebSocketServer(port);
          serverProcesses.set(port, serverInfo);
        }
        
        // Start capturing the space
        logger.info(`Starting capture ${i + 1} for URL: ${url}`);
        await startCapturingSpace(url, port, options.headless, websocketUrl, i);
        
        // Add a small delay between starting captures to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error(`Failed to start capture for space ${i + 1}: ${error.message}`);
      }
    }
    
    logger.info('All captures started. Press Ctrl+C to stop all captures.');
    
    // Keep the process running until user terminates
    process.stdin.resume();
    
  } catch (error) {
    logger.error(`Error in main process: ${error.message}`);
    logger.debug(error.stack);
    await cleanup();
    process.exit(1);
  }
}

// Run the application
main().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  logger.debug(error.stack);
  process.exit(1);
}); 