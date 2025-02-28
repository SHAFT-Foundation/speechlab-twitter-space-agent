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
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const readline = require('readline');
const { startCapture } = require('./src/index');

// Configure CLI
const program = new Command();
program
  .name('capture-space')
  .description('Capture audio from a Twitter Space')
  .version('1.0.0')
  .option('-u, --url <url>', 'Twitter Space URL to capture')
  .option('-d, --debug', 'Enable debug logging')
  .option('-t, --test-mode', 'Run in test mode', true)
  .option('-w, --websocket <endpoint>', 'WebSocket endpoint', 'wss://localryan.ngrok.app/meeting/wuw-vfud-cre/audio')
  .option('--headless', 'Run in headless mode (browser not visible)', true)
  .option('--visible', 'Run in visible mode (browser visible)', false)
  .option('-p, --port <port>', 'WebSocket server port', 8080)
  .option('-l, --limit <limit>', 'Limit of spaces to check when discovering', 5)
  .parse(process.argv);

const options = program.opts();

// Configure logging
logger.level = options.debug ? 'debug' : (process.env.LOG_LEVEL || 'info');

// Determine headless mode - if visible is true, override headless
const isHeadless = options.visible ? false : options.headless;

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
async function startCapturingSpace(spaceUrl) {
  logger.info(`Starting to capture Twitter Space: ${spaceUrl}`);
  
  // Save space details to a file
  const spaceDetailsPath = path.join(__dirname, 'current-space-details.txt');
  
  try {
    // Format space details
    let spaceDetails = '';
    if (typeof spaceUrl === 'object') {
      // If we have a space object with details
      spaceDetails = formatSpaceDetails(spaceUrl);
      spaceUrl = spaceUrl.url; // Extract just the URL for the capture process
    } else {
      // If we just have a URL
      spaceDetails = `Twitter Space URL: ${spaceUrl}\nCapture started: ${new Date().toISOString()}`;
    }
    
    // Write space details to file
    fs.writeFileSync(spaceDetailsPath, spaceDetails);
    logger.info(`Space details saved to ${spaceDetailsPath}`);
    
    // Log parameters
    logger.info(`Space URL: ${spaceUrl}`);
    logger.info(`Headless mode: ${isHeadless ? 'enabled' : 'disabled'}`);
    logger.info(`WebSocket endpoint: ${options.websocket || 'local server'}`);
    logger.info(`Space details saved to: ${spaceDetailsPath}`);
    
    // Build command arguments
    const args = [
      path.join(__dirname, 'src/index.js'),
      '--url', spaceUrl
    ];
    
    // Add WebSocket options
    if (options.websocket) {
      args.push('--websocket', options.websocket);
    } else {
      args.push('--websocket', `ws://localhost:${options.port}`);
    }
    
    // Add debug flag if enabled
    if (options.debug) {
      args.push('--debug');
    }
    
    // Add headless flag based on the determined mode
    if (!isHeadless) {
      logger.debug('Running in visible mode (headless=false)');
      args.push('--visible');
      // Also set environment variable for child process
      process.env.BROWSER_HEADLESS = 'false';
    } else {
      logger.debug('Running in headless mode (headless=true)');
      args.push('--headless');
      process.env.BROWSER_HEADLESS = 'true';
    }
    
    // Add test mode flag if enabled
    if (options.testMode) {
      args.push('--test-mode');
    }
    
    // Add port if specified
    if (options.port) {
      args.push('--port', options.port.toString());
    }
    
    logger.debug(`Starting capture process with args: ${args.join(' ')}`);
    
    // Start the capture process
    const captureProcess = spawn('node', args, {
      stdio: 'inherit' // Inherit stdio from parent process
    });
    
    logger.info(`Capture process started with PID: ${captureProcess.pid}`);
    console.log(`\n✅ Capture process started (PID: ${captureProcess.pid})`);
    console.log(`\nPress Ctrl+C to stop capturing.`);
    
    // Handle process exit
    captureProcess.on('exit', (code, signal) => {
      if (code === 0) {
        logger.info('Capture process exited successfully');
        console.log('\n✅ Capture process completed successfully');
      } else {
        logger.error(`Capture process exited with code ${code} and signal ${signal}`);
        console.log(`\n❌ Capture process failed with code ${code}`);
      }
    });
    
    // Handle process error
    captureProcess.on('error', (error) => {
      logger.error(`Capture process error: ${error.message}`);
      console.log(`\n❌ Capture process error: ${error.message}`);
    });
    
    return {
      process: captureProcess,
      pid: captureProcess.pid,
      url: spaceUrl
    };
  } catch (error) {
    logger.error(`Failed to start capturing space: ${error.message}`);
    console.log(`\n❌ Failed to start capturing space: ${error.message}`);
    throw error;
  }
}

/**
 * Start the WebSocket server if not already running
 * @returns {Promise<Object>} Server process information
 */
function startWebSocketServer() {
  // If using external WebSocket, don't start local server
  if (options.websocket && !options.websocket.includes('localhost')) {
    logger.info(`Using external WebSocket server: ${options.websocket}`);
    return Promise.resolve(null);
  }
  
  return new Promise((resolve, reject) => {
    // Check if we should start the server
    const shouldStartServer = !options.websocket || options.websocket.includes('localhost');
    
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
 * Parse command line arguments
 */
function parseArgs() {
  return yargs(hideBin(process.argv))
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'Twitter Space URL to capture'
    })
    .option('debug', {
      alias: 'd',
      type: 'boolean',
      description: 'Enable debug logging',
      default: false
    })
    .option('headless', {
      alias: 'h',
      type: 'boolean',
      description: 'Run in headless mode',
      default: false
    })
    .option('port', {
      alias: 'p',
      type: 'number',
      description: 'WebSocket server port',
      default: 8080
    })
    .option('limit', {
      alias: 'l',
      type: 'number',
      description: 'Limit of spaces to check when discovering',
      default: 5
    })
    .help()
    .argv;
}

/**
 * Create readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
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
      const popularSpaces = await discoverTwitterSpaces({
        language: 'en', // Default to English spaces
        mode: 'top',    // Get top spaces
        limit: 5        // Check top 5 spaces
      });
      
      if (!popularSpaces || popularSpaces.length === 0) {
        throw new Error('No active Twitter Spaces found');
      }
      
      // Get the most popular space
      const popularSpace = popularSpaces[0];
      
      console.log("\n✅ Found popular Twitter Space!");
      logger.info(`Found popular Twitter Space: "${popularSpace.title}" by ${popularSpace.host} (${popularSpace.listeners} listeners)`);
      logger.info(`Space URL: ${popularSpace.url}`);
      
      // Confirm with the user before proceeding
      console.log("\nWould you like to capture this Space? (y/n)");
      process.stdin.once('data', async (data) => {
        const input = data.toString().trim().toLowerCase();
        if (input === 'y' || input === 'yes') {
          // Start capturing the space
          const captureInfo = await startCapturingSpace(popularSpace);
          
          // Handle graceful shutdown
          setupShutdownHandler(captureInfo, serverInfo);
        } else {
          console.log("\nCapture cancelled. Please provide a specific Twitter Space URL using the --url option.");
          process.exit(0);
        }
      });
      
    } catch (error) {
      console.log(`\n❌ Error finding Twitter Spaces: ${error.message}`);
      logger.error(`Error finding Twitter Spaces: ${error.message}`);
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