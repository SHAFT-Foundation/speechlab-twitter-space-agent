#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const logger = require('./utils/logger');
const { provisionVM, terminateVM } = require('./azure/vm-manager');
const { launchBrowser, loginToTwitter, joinTwitterSpace } = require('./browser/browser-automation');
const { setupAudioCapture, startRecording, stopRecording } = require('./audio/audio-capture');
const { connectToWebSocket, sendAudioChunk } = require('./audio/websocket-client');

// CLI configuration
const program = new Command();
program
  .name('twitter-space-audio-capture')
  .description('Captures audio from Twitter Spaces and streams it to a websocket endpoint')
  .version('1.0.0')
  .option('-u, --url <url>', 'Twitter Space URL to join')
  .option('-w, --websocket <url>', 'WebSocket endpoint to stream audio to')
  .option('-k, --keep-vm', 'Keep the VM running after completion')
  .option('-d, --debug', 'Enable debug logging')
  .option('-t, --test-mode', 'Run in test mode without creating Azure VM')
  .parse(process.argv);

const options = program.opts();

// Configure logger based on debug flag
if (options.debug) {
  logger.level = 'debug';
}

// Override websocket URL if provided in CLI
const websocketEndpoint = options.websocket || process.env.WEBSOCKET_ENDPOINT;

// Global variables for cleanup
let vmInfo = null;
let browser = null;
let audioCapture = null;
let wsConnection = null;

/**
 * Main application flow
 */
async function main() {
  logger.info('Starting Twitter Space Audio Capture');
  logger.info(`Target Twitter Space: ${options.url}`);
  logger.info(`WebSocket Endpoint: ${websocketEndpoint}`);

  try {
    // Step 1: Provision Azure VM if not in test mode
    if (!options.testMode) {
      logger.info('Provisioning Azure VM...');
      vmInfo = await provisionVM();
      logger.info(`VM provisioned successfully: ${vmInfo.ipAddress}`);
    }

    // Step 2: Launch browser and automate Twitter login
    logger.info('Launching browser...');
    browser = await launchBrowser(options.testMode ? null : vmInfo);
    
    logger.info('Logging into Twitter...');
    const authPage = await loginToTwitter(browser);
    
    // Step 3: Join Twitter Space using the same authenticated page
    logger.info(`Joining Twitter Space: ${options.url}`);
    const spacePage = await joinTwitterSpace(authPage, options.url);
    
    // Step 4: Setup audio capture
    logger.info('Setting up audio capture...');
    audioCapture = await setupAudioCapture(spacePage);
    
    // Step 5: Connect to WebSocket endpoint
    logger.info(`Connecting to WebSocket: ${websocketEndpoint}`);
    wsConnection = await connectToWebSocket(websocketEndpoint);
    
    // Step 6: Start recording and streaming
    logger.info('Starting audio recording and streaming...');
    await startRecording(audioCapture, async (chunk) => {
      await sendAudioChunk(wsConnection, chunk);
    });
    
    // Keep the process running until user terminates
    logger.info('Recording in progress. Press Ctrl+C to stop.');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await cleanup();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error(`Error in main process: ${error.message}`);
    logger.debug(error.stack);
    await cleanup();
    process.exit(1);
  }
}

/**
 * Cleanup resources before exit
 */
async function cleanup() {
  logger.info('Cleaning up resources...');
  
  try {
    if (audioCapture) {
      logger.info('Stopping audio recording...');
      await stopRecording(audioCapture);
    }
    
    if (wsConnection) {
      logger.info('Closing WebSocket connection...');
      wsConnection.close();
    }
    
    if (browser) {
      logger.info('Closing browser...');
      await browser.close();
    }
    
    if (vmInfo && !options.keepVm) {
      logger.info('Terminating Azure VM...');
      await terminateVM(vmInfo.name);
    }
    
    logger.info('Cleanup complete.');
  } catch (error) {
    logger.error(`Error during cleanup: ${error.message}`);
    logger.debug(error.stack);
  }
}

// Run the application
main().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  logger.debug(error.stack);
  process.exit(1);
}); 