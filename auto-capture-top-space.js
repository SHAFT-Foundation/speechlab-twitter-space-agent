#!/usr/bin/env node

/**
 * Auto-Capture Top Twitter Space
 * 
 * This script automatically finds the most popular Twitter Space
 * and starts capturing its audio. It's designed for testing the
 * Twitter Space audio capture system with live content.
 */

require('dotenv').config();
const { findMostPopularSpace } = require('./src/browser/spaces-discovery');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./src/utils/logger');

// Configure logging
logger.level = process.env.LOG_LEVEL || 'info';

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
Title: ${space.title}
URL: ${space.url}
Space ID: ${space.id || 'Unknown'}
Host: ${space.host}
Listeners: ${space.listeners}
Status: ${space.status || 'Unknown'}
${space.timestamp ? `Time: ${space.timestamp}` : ''}
Discovered At: ${space.discoveredAt || new Date().toISOString()}
=================================================
`;
}

/**
 * Start capturing a Twitter Space
 * @param {Object} space - Twitter Space to capture
 * @returns {Promise<Object>} Process information
 */
function startCapturingSpace(space) {
  return new Promise((resolve, reject) => {
    // Log detailed space information
    const spaceDetails = formatSpaceDetails(space);
    console.log(spaceDetails);
    logger.info(`Starting capture of Twitter Space: "${space.title}"`);
    logger.info(`URL: ${space.url}`);
    logger.info(`Host: ${space.host}`);
    logger.info(`Listeners: ${space.listeners}`);
    
    // Save space info to a file for reference
    const spaceInfoFile = path.join(__dirname, 'current-space.json');
    fs.writeFileSync(
      spaceInfoFile,
      JSON.stringify({
        ...space,
        captureStartedAt: new Date().toISOString()
      }, null, 2),
      'utf8'
    );
    
    // Also save the formatted details to a text file for easy reference
    const spaceDetailsFile = path.join(__dirname, 'current-space-details.txt');
    fs.writeFileSync(spaceDetailsFile, spaceDetails, 'utf8');
    logger.info(`Space details saved to: ${spaceDetailsFile}`);
    
    // Execute the capture command
    const captureProcess = spawn('node', [
      path.join(__dirname, 'src', 'index.js'),
      '--url', space.url,
      '--test-mode',
      '--debug'
    ], {
      stdio: 'inherit'
    });
    
    // Handle process events
    captureProcess.on('error', (error) => {
      logger.error(`Failed to start capture process: ${error.message}`);
      reject(error);
    });
    
    captureProcess.on('exit', (code, signal) => {
      if (code !== 0) {
        logger.error(`Capture process exited with code ${code} and signal ${signal}`);
        reject(new Error(`Process exited with code ${code}`));
      } else {
        logger.info('Capture process completed successfully');
        resolve();
      }
    });
    
    // Return process info
    resolve({
      process: captureProcess,
      space: space,
      pid: captureProcess.pid
    });
    
    // Log PID for potential manual termination
    logger.info(`Capture process started with PID: ${captureProcess.pid}`);
    console.log(`\nCapture process running with PID: ${captureProcess.pid}`);
    console.log('Press Ctrl+C to stop the capture process.');
  });
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
          pid: serverProcess.pid
        });
      }
    });
    
    // Handle server errors
    serverProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      console.error(`[WebSocket Server Error] ${errorOutput.trim()}`);
      logger.error(`WebSocket server error: ${errorOutput}`);
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
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("\n=== TWITTER SPACE AUTO-CAPTURE TOOL ===\n");
    console.log("This tool will automatically find and capture the most popular Twitter Space");
    console.log("for testing purposes.\n");
    
    // Start WebSocket server if needed
    const serverInfo = await startWebSocketServer();
    
    // Find the most popular Twitter Space
    console.log("\nSearching for the most popular Twitter Space...");
    logger.info('Finding the most popular Twitter Space...');
    const popularSpace = await findMostPopularSpace({
      language: 'en' // Default to English spaces
    });
    
    if (!popularSpace) {
      console.log("\n❌ No Twitter Spaces found. Please try again later.");
      logger.error('No Twitter Spaces found. Please try again later.');
      process.exit(1);
    }
    
    console.log("\n✅ Found popular Twitter Space!");
    
    // Start capturing the space
    const captureInfo = await startCapturingSpace(popularSpace);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log("\n\nStopping capture process...");
      logger.info('Stopping capture process...');
      
      if (captureInfo && captureInfo.process) {
        captureInfo.process.kill();
      }
      
      if (serverInfo && serverInfo.process) {
        serverInfo.process.kill();
      }
      
      logger.info('Cleanup complete. Exiting...');
      console.log("Cleanup complete. Exiting...");
      process.exit(0);
    });
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    logger.error(`Error: ${error.message}`);
    logger.debug(error.stack);
    process.exit(1);
  }
}

// Run the main function
main();