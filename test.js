#!/usr/bin/env node

/**
 * Simple test script to verify the installation of dependencies
 * and basic functionality without connecting to Azure or Twitter.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const WebSocket = require('ws');
const logger = require('./src/utils/logger');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_WEBSOCKET_PORT = 8080;
const TEST_AUDIO_FILE = path.join(__dirname, 'test-audio.wav');

async function runTests() {
  logger.info('Starting installation verification tests...');
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Check environment variables
  try {
    logger.info('Test 1: Checking environment variables...');
    const requiredVars = [
      'AZURE_SUBSCRIPTION_ID',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'TWITTER_USERNAME',
      'TWITTER_PASSWORD'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.warn(`Missing environment variables: ${missingVars.join(', ')}`);
      logger.warn('These will be required for full functionality.');
    } else {
      logger.info('All required environment variables are set.');
    }
    
    testsPassed++;
  } catch (error) {
    logger.error(`Test 1 failed: ${error.message}`);
    testsFailed++;
  }
  
  // Test 2: Check Playwright installation
  try {
    logger.info('Test 2: Checking Playwright installation...');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    logger.info('Playwright is working correctly.');
    testsPassed++;
  } catch (error) {
    logger.error(`Test 2 failed: ${error.message}`);
    logger.error('Playwright installation issue. Try running: npx playwright install');
    testsFailed++;
  }
  
  // Test 3: Check WebSocket functionality
  try {
    logger.info('Test 3: Testing WebSocket functionality...');
    
    // Create a simple WebSocket server
    const wss = new WebSocket.Server({ port: TEST_WEBSOCKET_PORT });
    
    wss.on('connection', (ws) => {
      logger.info('Test WebSocket server received a connection.');
      ws.on('message', (message) => {
        logger.info(`Test WebSocket server received: ${message}`);
        ws.send(JSON.stringify({ status: 'ok', message: 'Test successful' }));
      });
    });
    
    // Connect a client
    const client = new WebSocket(`ws://localhost:${TEST_WEBSOCKET_PORT}`);
    
    await new Promise((resolve, reject) => {
      client.on('open', () => {
        logger.info('Test WebSocket client connected successfully.');
        client.send(JSON.stringify({ type: 'test' }));
      });
      
      client.on('message', (data) => {
        logger.info(`Test WebSocket client received: ${data}`);
        client.close();
        wss.close();
        resolve();
      });
      
      client.on('error', (error) => {
        reject(error);
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('WebSocket test timed out'));
      }, 5000);
    });
    
    logger.info('WebSocket functionality is working correctly.');
    testsPassed++;
  } catch (error) {
    logger.error(`Test 3 failed: ${error.message}`);
    testsFailed++;
  }
  
  // Test 4: Check file system access
  try {
    logger.info('Test 4: Checking file system access...');
    
    // Create test directories
    const testDirs = ['logs', 'recordings'];
    testDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }
    });
    
    // Create a test file
    fs.writeFileSync(TEST_AUDIO_FILE, Buffer.from([0, 0, 0, 0]));
    
    // Read the test file
    fs.readFileSync(TEST_AUDIO_FILE);
    
    // Clean up
    fs.unlinkSync(TEST_AUDIO_FILE);
    
    logger.info('File system access is working correctly.');
    testsPassed++;
  } catch (error) {
    logger.error(`Test 4 failed: ${error.message}`);
    testsFailed++;
  }
  
  // Summary
  logger.info('Test Summary:');
  logger.info(`Tests passed: ${testsPassed}`);
  logger.info(`Tests failed: ${testsFailed}`);
  
  if (testsFailed === 0) {
    logger.info('All tests passed! The installation appears to be working correctly.');
    return 0;
  } else {
    logger.error(`${testsFailed} test(s) failed. Please check the logs for details.`);
    return 1;
  }
}

// Run the tests
runTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    logger.error(`Unhandled error in tests: ${error.message}`);
    logger.debug(error.stack);
    process.exit(1);
  }); 