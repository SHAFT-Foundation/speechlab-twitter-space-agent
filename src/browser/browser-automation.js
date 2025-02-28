const { chromium } = require('playwright');
const logger = require('../utils/logger');

/**
 * Launch a browser instance
 * @param {Object} vmInfo - Information about the VM if running remotely
 * @returns {Browser} Browser instance
 */
async function launchBrowser(vmInfo) {
  logger.info('Launching browser...');
  
  try {
    const launchOptions = {
      headless: false, // We need a headed browser to play audio
      args: [
        '--autoplay-policy=no-user-gesture-required', // Allow autoplay
        '--use-fake-ui-for-media-stream', // Auto-accept media permissions
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--mute-audio', // Initially mute so we don't hear it locally
        '--disable-infobars',
        '--disable-breakpad',
      ]
    };
    
    // If we're connecting to a remote VM
    if (vmInfo) {
      logger.debug(`Connecting to remote browser on VM: ${vmInfo.ipAddress}`);
      // In a real implementation, we'd need to install and start a browser on the VM
      // For hackathon purposes, we'll just simulate this
      // TODO: Add code to connect to remote browser via CDP
    }
    
    const browser = await chromium.launch(launchOptions);
    logger.info('Browser launched successfully');
    
    return browser;
  } catch (error) {
    logger.error(`Failed to launch browser: ${error.message}`);
    throw error;
  }
}

/**
 * Log into Twitter with provided credentials
 * @param {Browser} browser - Browser instance
 * @returns {Page} Authenticated page
 */
async function loginToTwitter(browser) {
  logger.info('Starting Twitter login process...');
  
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;
  
  if (!username || !password) {
    throw new Error('Twitter credentials are required in environment variables');
  }
  
  try {
    const page = await browser.newPage();
    
    // Navigate to Twitter login page
    logger.debug('Navigating to Twitter login page...');
    await page.goto('https://twitter.com/i/flow/login', { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for the username field
    logger.debug('Waiting for username field...');
    await page.waitForSelector('input[autocomplete="username"]');
    
    // Type username and click next
    logger.debug(`Entering username: ${username}`);
    await page.fill('input[autocomplete="username"]', username);
    await page.click('div[role="button"]:has-text("Next")');
    
    // Wait for password field
    logger.debug('Waiting for password field...');
    await page.waitForSelector('input[type="password"]');
    
    // Type password and login
    logger.debug('Entering password...');
    await page.fill('input[type="password"]', password);
    await page.click('div[role="button"]:has-text("Log in")');
    
    // Wait for login to complete
    logger.debug('Waiting for login to complete...');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    
    // Check if we're logged in
    const isLoggedIn = await page.evaluate(() => {
      return document.querySelector('a[href="/home"]') !== null;
    });
    
    if (!isLoggedIn) {
      logger.error('Login failed. Could not verify login success.');
      throw new Error('Twitter login failed');
    }
    
    logger.info('Successfully logged into Twitter');
    return page;
  } catch (error) {
    logger.error(`Twitter login failed: ${error.message}`);
    throw error;
  }
}

/**
 * Join a Twitter Space
 * @param {Browser} browser - Browser instance
 * @param {string} spaceUrl - URL of the Twitter Space
 * @returns {Page} Page with active Twitter Space
 */
async function joinTwitterSpace(browser, spaceUrl) {
  logger.info(`Joining Twitter Space: ${spaceUrl}`);
  
  if (!spaceUrl) {
    throw new Error('Twitter Space URL is required');
  }
  
  try {
    const page = await browser.newPage();
    
    // Navigate to Twitter Space URL
    logger.debug(`Navigating to Twitter Space: ${spaceUrl}`);
    await page.goto(spaceUrl, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for the Twitter Space to load and play button to appear
    logger.debug('Waiting for Twitter Space to load...');
    
    // Twitter has different selectors depending on the status of the Space
    // We'll check for both "Listen live" and "Play recording" buttons
    await Promise.race([
      page.waitForSelector('div[role="button"]:has-text("Listen live")', { timeout: 30000 }),
      page.waitForSelector('div[role="button"]:has-text("Play recording")', { timeout: 30000 }),
      page.waitForSelector('div[data-testid="audioSpacePlayButton"]', { timeout: 30000 })
    ]);
    
    // Click on play button
    logger.debug('Clicking play button...');
    try {
      await page.click('div[role="button"]:has-text("Listen live")');
    } catch (e) {
      try {
        await page.click('div[role="button"]:has-text("Play recording")');
      } catch (e2) {
        await page.click('div[data-testid="audioSpacePlayButton"]');
      }
    }
    
    // Wait for audio to start playing
    logger.debug('Waiting for audio to start playing...');
    
    // Twitter often has a loading indicator when the audio is connecting
    await page.waitForSelector('div[role="progressbar"]', { timeout: 10000 }).catch(() => {
      logger.debug('No loading indicator found, continuing...');
    });
    
    // Check if audio is playing
    const isPlaying = await checkIfAudioIsPlaying(page);
    
    if (!isPlaying) {
      logger.error('Could not verify that audio is playing.');
      throw new Error('Failed to join Twitter Space');
    }
    
    logger.info('Successfully joined Twitter Space');
    return page;
  } catch (error) {
    logger.error(`Failed to join Twitter Space: ${error.message}`);
    throw error;
  }
}

/**
 * Check if audio is playing in the page
 * @param {Page} page - Playwright page
 * @returns {boolean} True if audio is playing
 */
async function checkIfAudioIsPlaying(page) {
  logger.debug('Checking if audio is playing...');
  
  try {
    // This is a heuristic. Twitter doesn't provide a clear indication of audio playing.
    // We'll check for the presence of audio elements or specific UI elements that indicate playback.
    
    return await page.evaluate(() => {
      // Check for audio elements
      const audioElements = Array.from(document.querySelectorAll('audio'));
      const hasActiveAudio = audioElements.some(audio => !audio.paused);
      
      // Check for mute button which indicates audio is available
      const hasMuteButton = document.querySelector('div[data-testid="muteButton"]') !== null;
      
      // Check for speaker icon or other indicators
      const hasSpeakerIcon = document.querySelector('svg[aria-label*="Volume"]') !== null;
      
      return hasActiveAudio || hasMuteButton || hasSpeakerIcon;
    });
  } catch (error) {
    logger.error(`Error checking audio playback: ${error.message}`);
    return false;
  }
}

module.exports = {
  launchBrowser,
  loginToTwitter,
  joinTwitterSpace
}; 