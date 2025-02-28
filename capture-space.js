#!/usr/bin/env node

/**
 * Capture Twitter Space
 * 
 * This script captures audio from a specified Twitter Space URL
 * or attempts to find a popular space if no URL is provided.
 */

require('dotenv').config();
const { Command } = require('commander');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./src/utils/logger');
const { discoverTwitterSpaces, findMostPopularSpace, findSpacesByQuery } = require('./src/browser/spaces-discovery');

// Configure CLI
const program = new Command();
program
  .name('capture-space')
  .description('Capture audio from a Twitter Space')
  .version('1.0.0')
  .option('-u, --url <url>', 'Twitter Space URL to capture')
  .option('-d, --debug', 'Enable debug logging')
  .option('-t, --test-mode', 'Run in test mode', true)
  .option('-w, --websocket <endpoint>', 'WebSocket endpoint')
  .parse(process.argv);

const options = program.opts();

// Configure logging
logger.level = options.debug ? 'debug' : (process.env.LOG_LEVEL || 'info');

/**
 * Format space information for display
 * @param {Object} space - Twitter Space object
 * @returns {string} Formatted string
 */
function formatSpaceDetails(space) {
  return `
=================================================
TWITTER SPACE DETAILS:
=================================================
Title: ${space.title || 'Unknown Title'}
URL: ${space.url}
${space.id ? `Space ID: ${space.id}` : ''}
${space.host ? `Host: ${space.host}` : ''}
${space.listeners ? `Listeners: ${space.listeners}` : ''}
${space.status ? `Status: ${space.status}` : ''}
${space.timestamp ? `Time: ${space.timestamp}` : ''}
Captured At: ${new Date().toISOString()}
=================================================
`;
}

/**
 * Start capturing a Twitter Space
 * @param {string|Object} space - Twitter Space URL or space object
 * @returns {Promise<Object>} Capture process information
 */
async function startCapturingSpace(space) {
  // Extract the URL if a space object was provided
  const spaceUrl = typeof space === 'string' ? space : space.url;
  const spaceTitle = typeof space === 'string' ? 'Direct URL Capture' : space.title;
  const spaceHost = typeof space === 'string' ? '' : space.host;
  const spaceListeners = typeof space === 'string' ? '' : space.listeners;
  
  // Create a details file with information about the space
  const detailsPath = path.join(process.cwd(), 'current-space-details.txt');
  const details = `
=================================================
TWITTER SPACE DETAILS:
=================================================
Title: ${spaceTitle}
URL: ${spaceUrl}
${spaceHost ? `Host: ${spaceHost}` : ''}
${spaceListeners ? `Listeners: ${spaceListeners}` : ''}


Captured At: ${new Date().toISOString()}
=================================================
`;

  fs.writeFileSync(detailsPath, details);
  
  // Log the details
  console.log(details);
  
  // Start the capture process
  logger.info(`Starting capture of Twitter Space: ${spaceTitle}`);
  logger.info(`URL: ${spaceUrl}`);
  logger.info(`Space details saved to: ${detailsPath}`);
  
  // Build the command arguments
  const args = [
    path.join(__dirname, 'src/index.js'),
    '--url', spaceUrl
  ];
  
  // Add debug flag if needed
  if (options.debug) {
    args.push('--debug');
  }
  
  // Add test mode flag if needed
  if (options.testMode) {
    args.push('--test-mode');
  }
  
  // Add websocket endpoint if specified
  if (options.websocket) {
    args.push('--websocket', options.websocket);
  }
  
  // Start the capture process
  const captureProcess = spawn('node', args, {
    stdio: 'inherit'
  });
  
  logger.info(`Capture process started with PID: ${captureProcess.pid}`);
  console.log(`\nCapture process running with PID: ${captureProcess.pid}`);
  console.log(`Press Ctrl+C to stop the capture process.`);
  
  // Handle process events
  captureProcess.on('exit', (code, signal) => {
    logger.info(`Capture process exited with code ${code} and signal ${signal}`);
  });
  
  captureProcess.on('error', (error) => {
    logger.error(`Capture process error: ${error.message}`);
  });
  
  return {
    process: captureProcess,
    pid: captureProcess.pid,
    url: spaceUrl,
    title: spaceTitle
  };
}

/**
 * Start the WebSocket server if not already running
 * @returns {Promise<Object>} Server process information
 */
function startWebSocketServer() {
  return new Promise((resolve, reject) => {
    // Check if we should start the server
    const shouldStartServer = process.env.WEBSOCKET_ENDPOINT && 
                             process.env.WEBSOCKET_ENDPOINT.includes('localhost');
    
    if (!shouldStartServer) {
      logger.info('Using external WebSocket server, not starting local server');
      return resolve(null);
    }
    
    // First check if the port is already in use
    const net = require('net');
    const port = 8080; // Default port for the test server
    
    const tester = net.createServer()
      .once('error', err => {
        if (err.code === 'EADDRINUSE') {
          logger.info('WebSocket server port 8080 is already in use, assuming server is running');
          // Port is in use, assume server is already running
          resolve({
            isExisting: true,
            pid: null
          });
        } else {
          reject(err);
        }
      })
      .once('listening', () => {
        // Port is free, close the tester and start the actual server
        tester.close(() => {
          logger.info('Starting local WebSocket server...');
          
          // Start the test server
          const serverProcess = spawn('node', [
            path.join(__dirname, 'test-server.js')
          ], {
            detached: true,
            stdio: 'pipe' // Capture output
          });
          
          // Handle server output
          let serverOutput = '';
          serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            console.log(`[WebSocket Server] ${output.trim()}`);
            
            // Check if server is ready
            if (output.includes('WebSocket server started on port')) {
              logger.info('WebSocket server started successfully');
              resolve({
                process: serverProcess,
                pid: serverProcess.pid,
                isExisting: false
              });
            }
          });
          
          // Handle server errors
          serverProcess.stderr.on('data', (data) => {
            const errorOutput = data.toString();
            console.error(`[WebSocket Server Error] ${errorOutput.trim()}`);
            logger.error(`WebSocket server error: ${errorOutput}`);
            
            // If we see the EADDRINUSE error, assume server is already running
            if (errorOutput.includes('EADDRINUSE')) {
              logger.info('WebSocket server port is already in use, assuming server is running');
              resolve({
                isExisting: true,
                pid: null
              });
            }
          });
          
          // Handle process errors
          serverProcess.on('error', (error) => {
            logger.error(`Failed to start WebSocket server: ${error.message}`);
            reject(error);
          });
          
          // Set a timeout for server startup
          setTimeout(() => {
            if (serverOutput.includes('WebSocket server started on port')) {
              return; // Already resolved
            }
            logger.error('WebSocket server failed to start within timeout period');
            reject(new Error('WebSocket server startup timeout'));
          }, 10000);
        });
      })
      .listen(port);
  });
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("\n=== TWITTER SPACE CAPTURE TOOL ===\n");
    
    // Start WebSocket server if needed
    const serverInfo = await startWebSocketServer();
    
    // Check if URL was provided
    if (options.url) {
      console.log(`\nCapturing Twitter Space from provided URL: ${options.url}\n`);
      const captureInfo = await startCapturingSpace(options.url);
      
      // Handle graceful shutdown
      setupShutdownHandler(captureInfo, serverInfo);
      return;
    }
    
    // If no URL provided, try to find a popular space
    console.log("\nNo URL provided. Searching for the most popular Twitter Space...");
    logger.info('Finding the most popular Twitter Space...');
    
    try {
      // Use our discovery module to find active spaces
      logger.debug('Using spaces-discovery module to find active Twitter Spaces');
      const popularSpace = await findMostPopularSpace({
        language: 'en', // Default to English spaces
        mode: 'top',    // Get top spaces
        limit: 5        // Check top 5 spaces
      });
      
      if (!popularSpace) {
        console.log("\n❌ No Twitter Spaces found. Please try again later or provide a URL directly.");
        logger.error('No Twitter Spaces found. Please try again later.');
        process.exit(1);
      }
      
      console.log("\n✅ Found popular Twitter Space!");
      logger.info(`Found popular Twitter Space: "${popularSpace.title}" by ${popularSpace.host} (${popularSpace.listeners} listeners)`);
      logger.info(`Space URL: ${popularSpace.url}`);
      
      // Start capturing the space
      const captureInfo = await startCapturingSpace(popularSpace);
      
      // Handle graceful shutdown
      setupShutdownHandler(captureInfo, serverInfo);
      
    } catch (error) {
      console.log(`\n❌ Error finding Twitter Spaces: ${error.message}`);
      console.log("\nPlease provide a Twitter Space URL directly using the --url option:");
      console.log("Example: ./capture-space.js --url https://twitter.com/i/spaces/your-space-id");
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    logger.error(`Error: ${error.message}`);
    logger.debug(error.stack);
    process.exit(1);
  }
}

/**
 * Set up graceful shutdown handler
 */
function setupShutdownHandler(captureInfo, serverInfo) {
  process.on('SIGINT', async () => {
    console.log("\n\nStopping capture process...");
    logger.info('Stopping capture process...');
    
    if (captureInfo && captureInfo.process) {
      captureInfo.process.kill();
    }
    
    // Only kill the server process if we started it (not if it was already running)
    if (serverInfo && serverInfo.process && !serverInfo.isExisting) {
      logger.info('Stopping WebSocket server...');
      serverInfo.process.kill();
    }
    
    logger.info('Cleanup complete. Exiting...');
    console.log("Cleanup complete. Exiting...");
    process.exit(0);
  });
}

// Run the main function
main(); 