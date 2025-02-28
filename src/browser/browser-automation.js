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
      slowMo: 100, // Add slight delay to avoid detection
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
  const email = process.env.TWITTER_EMAIL;
  
  if (!username || !password) {
    throw new Error('Twitter credentials are required in environment variables');
  }
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // Set a longer default timeout for all operations
    page.setDefaultTimeout(60000);
    
    // Navigate to Twitter login page
    logger.debug('Navigating to Twitter login page...');
    await page.goto('https://twitter.com/i/flow/login', { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    
    // Wait for the username field
    logger.debug('Waiting for username field...');
    await page.waitForSelector('input[autocomplete="username"]', { state: 'visible', timeout: 10000 });
    
    // Type username/email and press Enter
    logger.debug(`Entering username or email: ${email || username}`);
    await page.fill('input[autocomplete="username"]', email || username);
    await page.waitForTimeout(500);
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'login-username.png' });
    logger.debug('Saved screenshot to login-username.png');
    
    // Press Enter instead of clicking the Next button
    logger.debug('Pressing Enter to submit username/email...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    
    // Check if we need to handle email verification
    const emailSelector = 'input[autocomplete="username"]';
    const emailInput = await page.$(emailSelector);
    if (emailInput) {
      logger.debug('Email verification required...');
      await page.fill(emailSelector, email || username);
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    }
    
    // Wait for password field
    logger.debug('Waiting for password field...');
    await page.waitForSelector('input[name="password"], input[type="password"]', { state: 'visible', timeout: 30000 });
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'login-password.png' });
    logger.debug('Saved screenshot to login-password.png');
    
    // Type password and press Enter
    logger.debug('Entering password...');
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.waitForTimeout(500);
    
    // Press Enter instead of clicking the Log in button
    logger.debug('Pressing Enter to submit password...');
    await page.keyboard.press('Enter');
    
    // Wait for login to complete
    logger.debug('Waiting for login to complete...');
    await page.waitForTimeout(5000); // Wait a bit for any redirects
    
    // Take a screenshot after login attempt
    await page.screenshot({ path: 'login-complete.png' });
    logger.debug('Saved screenshot to login-complete.png');
    
    // Check if we're logged in using multiple indicators
    const isLoggedIn = await page.evaluate(() => {
      // Check for home link
      const hasHomeLink = document.querySelector('a[href="/home"]') !== null;
      
      // Check for profile icon
      const hasProfileIcon = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') !== null;
      
      // Check for tweet button
      const hasTweetButton = document.querySelector('[data-testid="tweetButtonInline"]') !== null;
      
      // Check for explore link
      const hasExploreLink = document.querySelector('a[href="/explore"]') !== null;
      
      // Check for primary column (timeline)
      const hasPrimaryColumn = document.querySelector('[data-testid="primaryColumn"]') !== null;
      
      return hasHomeLink || hasProfileIcon || hasTweetButton || hasExploreLink || hasPrimaryColumn;
    });
    
    if (!isLoggedIn) {
      logger.error('Login failed. Could not verify login success.');
      
      // Check if there's an error message
      const errorMessage = await page.evaluate(() => {
        const errorElement = document.querySelector('[data-testid="LoginForm_Error_Message"]');
        return errorElement ? errorElement.textContent : null;
      });
      
      if (errorMessage) {
        logger.error(`Twitter login error: ${errorMessage}`);
      }
      
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
 * @param {Page} page - Authenticated Playwright page
 * @param {string} spaceUrl - URL of the Twitter Space
 * @returns {Page} Page with active Twitter Space
 */
async function joinTwitterSpace(page, spaceUrl) {
  logger.info(`Joining Twitter Space: ${spaceUrl}`);
  
  if (!spaceUrl) {
    throw new Error('Twitter Space URL is required');
  }
  
  if (!page) {
    throw new Error('Authenticated page is required');
  }
  
  try {
    // Navigate to Twitter Space URL with a shorter timeout
    logger.debug(`Navigating to Twitter Space: ${spaceUrl}`);
    
    // Use a more reliable navigation strategy
    await page.goto(spaceUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait for the page to stabilize
    await page.waitForTimeout(5000);
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'space-loaded.png' });
    logger.debug('Saved screenshot to space-loaded.png');
    
    // Wait for the Twitter Space to load and play button to appear
    logger.debug('Waiting for Twitter Space to load...');
    
    // Twitter has different selectors depending on the status of the Space
    // We'll check for both "Listen live" and "Play recording" buttons
    const buttonSelectors = [
      'div[role="button"]:has-text("Listen live")',
      'div[role="button"]:has-text("Play recording")',
      'div[data-testid="audioSpacePlayButton"]',
      '[data-testid="audioSpace-audioOnlyPlayButton"]'
    ];
    
    // Try to find any of the play buttons
    let buttonFound = false;
    let buttonSelector = null;
    
    for (const selector of buttonSelectors) {
      logger.debug(`Looking for button with selector: ${selector}`);
      const button = await page.$(selector);
      if (button) {
        buttonFound = true;
        buttonSelector = selector;
        logger.debug(`Found button with selector: ${selector}`);
        break;
      }
    }
    
    if (!buttonFound) {
      logger.error('Could not find any play button on the page');
      // Take a screenshot to see what's on the page
      await page.screenshot({ path: 'space-no-button.png' });
      logger.debug('Saved screenshot to space-no-button.png');
      
      // Check if we're on the right page at least
      const pageTitle = await page.title();
      logger.debug(`Page title: ${pageTitle}`);
      
      // Try to get some content from the page to debug
      const pageContent = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          hasSpaceElements: document.querySelector('[data-testid="audioSpaceTitle"]') !== null,
          bodyText: document.body.innerText.substring(0, 500) // First 500 chars
        };
      });
      
      logger.debug('Page content:', pageContent);
      
      throw new Error('Could not find play button for Twitter Space');
    }
    
    // Take a screenshot before clicking play
    await page.screenshot({ path: 'space-before-play.png' });
    logger.debug('Saved screenshot to space-before-play.png');
    
    // Click on play button
    logger.debug(`Clicking play button with selector: ${buttonSelector}`);
    await page.click(buttonSelector);
    
    // Wait for audio to start playing
    logger.debug('Waiting for audio to start playing...');
    
    // Twitter often has a loading indicator when the audio is connecting
    await page.waitForSelector('div[role="progressbar"]', { timeout: 10000 }).catch(() => {
      logger.debug('No loading indicator found, continuing...');
    });
    
    // Take a screenshot after clicking play
    await page.waitForTimeout(5000); // Wait a bit for audio to start
    await page.screenshot({ path: 'space-after-play.png' });
    logger.debug('Saved screenshot to space-after-play.png');
    
    // Check if audio is playing
    const isPlaying = await checkIfAudioIsPlaying(page);
    
    if (!isPlaying) {
      logger.warn('Could not verify that audio is playing, but continuing anyway...');
      // We'll continue anyway since the verification might fail even when audio is playing
    } else {
      logger.info('Audio is playing successfully');
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
      
      // Check for space title which indicates we're in a space
      const hasSpaceTitle = document.querySelector('[data-testid="audioSpaceTitle"]') !== null;
      
      // Check for captions container which indicates a live space
      const hasCaptionsContainer = document.querySelector('[data-testid="captionsContainer"]') !== null;
      
      return hasActiveAudio || hasMuteButton || hasSpeakerIcon || hasSpaceTitle || hasCaptionsContainer;
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