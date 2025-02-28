#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const logger = require('./utils/logger');
const { provisionVM, terminateVM } = require('./azure/vm-manager');
const { launchBrowser, loginToTwitter, joinTwitterSpace } = require('./browser/browser-automation');
const { setupAudioCapture, startRecording, stopRecording } = require('./audio/audio-capture');
const { connectToWebSocket, sendAudioChunk } = require('./audio/websocket-client');
const fs = require('fs');
const path = require('path');

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
  .option('-t, --test-mode', 'Run in test mode without creating Azure VM', true)
  .option('--headless', 'Run in headless mode (browser not visible)', true)
  .option('--visible', 'Run in visible mode (browser visible)', false)
  .option('-p, --port <port>', 'WebSocket server port', 8080)
  .parse(process.argv);

const options = program.opts();

// Configure logger based on debug flag
if (options.debug) {
  logger.level = 'debug';
}

// Determine headless mode - if visible is true, override headless
const isHeadless = options.visible ? false : options.headless;

// Set environment variables based on options
process.env.BROWSER_HEADLESS = isHeadless ? 'true' : 'false';
logger.debug(`Setting BROWSER_HEADLESS to: ${process.env.BROWSER_HEADLESS}`);
logger.info(`Headless mode: ${isHeadless ? 'Enabled' : 'Disabled'}`);

// Override websocket URL if provided in CLI
const websocketEndpoint = options.websocket || process.env.WEBSOCKET_ENDPOINT || `ws://localhost:${options.port}`;

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
  logger.info(`Headless Mode: ${isHeadless ? 'Enabled' : 'Disabled'}`);

  // Create logs directory if it doesn't exist
  const logsDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  try {
    // Validate required parameters
    if (!options.url) {
      throw new Error('Twitter Space URL is required. Use --url option.');
    }

    if (!websocketEndpoint) {
      throw new Error('WebSocket endpoint is required. Set WEBSOCKET_ENDPOINT in .env or use --websocket option.');
    }

    // Step 1: Provision Azure VM if not in test mode
    if (!options.testMode) {
      logger.info('Provisioning Azure VM...');
      vmInfo = await provisionVM();
      logger.info(`VM provisioned successfully: ${vmInfo.ipAddress}`);
    } else {
      logger.info('Running in test mode, skipping Azure VM provisioning');
    }

    // Step 2: Launch browser with appropriate options
    logger.info('Launching browser...');
    const browserOptions = {
      headless: isHeadless,
      slowMo: isHeadless ? 0 : 50, // Only add slowMo in headed mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--mute-audio', // Initially mute so we don't hear it locally
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--enable-audio-service'
      ]
    };
    
    const browserObj = await launchBrowser(browserOptions);
    browser = browserObj.browser; // Store the browser instance for cleanup
    
    // Step 3: Login to Twitter
    logger.info('Logging into Twitter...');
    const authObj = await loginToTwitter(browserObj);
    
    // Step 4: Join Twitter Space using the authenticated page
    logger.info(`Joining Twitter Space: ${options.url}`);
    const spaceObj = await joinTwitterSpace(authObj, options.url);
    
    // Step 5: Setup audio capture
    logger.info('Setting up audio capture...');
    audioCapture = await setupAudioCapture(spaceObj.page);
    
    // Step 6: Connect to WebSocket endpoint
    logger.info(`Connecting to WebSocket: ${websocketEndpoint}`);
    wsConnection = await connectToWebSocket(websocketEndpoint);
    
    // Step 7: Start recording and streaming
    logger.info('Starting audio recording and streaming...');
    await startRecording(audioCapture, async (chunk) => {
      try {
        await sendAudioChunk(wsConnection, chunk);
      } catch (error) {
        logger.error(`Error sending audio chunk: ${error.message}`);
        // Don't throw here to keep recording even if sending fails
      }
    });
    
    // Keep the process running until user terminates
    logger.info('Recording in progress. Press Ctrl+C to stop.');
    
    // Handle graceful shutdown
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
    
  } catch (error) {
    logger.error(`Error in main process: ${error.message}`);
    logger.debug(error.stack);
    
    // Save error screenshot if browser is available
    if (browser) {
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.screenshot({ path: path.join(logsDir, 'error-screenshot.png') });
        logger.info('Saved error screenshot to logs/error-screenshot.png');
      } catch (screenshotError) {
        logger.error(`Failed to save error screenshot: ${screenshotError.message}`);
      }
    }
    
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
    
    if (vmInfo && !options.keepVm && !options.testMode) {
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

/**
 * Start the capture process
 * @param {Object} options - Capture options
 * @returns {Promise<void>}
 */
async function startCapture(options = {}) {
  // Override CLI options with provided options
  if (options.spaceUrl) {
    program.opts().url = options.spaceUrl;
  }
  
  if (options.port) {
    program.opts().port = options.port;
  }
  
  if (options.headless !== undefined) {
    program.opts().headless = options.headless;
    process.env.BROWSER_HEADLESS = options.headless ? 'true' : 'false';
  }
  
  // Run the main function
  return main();
}

// Export the startCapture function for use in other modules
module.exports = { startCapture }; 