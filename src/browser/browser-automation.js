const { chromium } = require('playwright');
const logger = require('../utils/logger');
const path = require('path');

// Define logs directory path
const logsDir = path.join(__dirname, '../../logs');

/**
 * Launch a browser instance with the specified options
 * @param {Object} options - Browser launch options
 * @returns {Promise<Object>} - Browser instance and page
 */
async function launchBrowser(options = {}) {
  const defaultOptions = {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--enable-audio-service',
      '--allow-file-access-from-files',
      '--allow-running-insecure-content',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-extensions',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--enable-automation',
      '--password-store=basic',
      '--use-mock-keychain',
      '--window-size=1280,720',
    ],
  };

  // Merge options with defaults
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    args: [...defaultOptions.args, ...(options.args || [])],
  };

  // Force headless mode based on environment variable, overriding any passed options
  const isHeadless = process.env.BROWSER_HEADLESS === 'false' ? false : mergedOptions.headless;
  mergedOptions.headless = isHeadless;
  
  // Log headless mode status
  logger.info(`Launching browser in ${isHeadless ? 'headless' : 'visible'} mode`);
  logger.debug(`BROWSER_HEADLESS env var: ${process.env.BROWSER_HEADLESS}`);

  // Add headless-specific arguments if needed
  if (isHeadless) {
    mergedOptions.args.push('--mute-audio');
    mergedOptions.args.push('--headless=new');
  } else {
    // Force headless to false to ensure it's not overridden
    mergedOptions.headless = false;
    logger.debug('Ensuring headless mode is disabled for visible browser');
  }

  try {
    logger.debug('Browser launch options:', JSON.stringify(mergedOptions, null, 2));
    const browser = await chromium.launch(mergedOptions);
    logger.info('Browser launched successfully');

    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Set up console logging from the browser
    page.on('console', message => {
      const type = message.type();
      const text = message.text();
      
      if (type === 'error') {
        logger.error(`Browser console error: ${text}`);
      } else if (type === 'warning') {
        logger.warn(`Browser console warning: ${text}`);
      } else {
        logger.debug(`Browser console [${type}]: ${text}`);
      }
    });

    return { browser, page, context };
  } catch (error) {
    logger.error(`Failed to launch browser: ${error.message}`);
    logger.debug(error.stack);
    throw error;
  }
}

/**
 * Login to Twitter with the provided credentials
 * @param {Object} browserObj - Browser object from launchBrowser
 * @returns {Promise<Object>} - Authenticated page
 */
async function loginToTwitter(browserObj) {
  logger.info('Starting Twitter login process...');
  
  // Extract browser components
  const { browser, page, context } = browserObj;
  
  try {
    // Set user agent to avoid detection
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36';
    
    try {
      await context.setExtraHTTPHeaders({
        'User-Agent': userAgent
      });
      logger.info('Set user agent via HTTP headers');
    } catch (error) {
      logger.warn(`Could not set user agent: ${error.message}`);
    }
    
    // Navigate to Twitter login page
    logger.info('Navigating to Twitter login page...');
    try {
      await page.goto('https://twitter.com/i/flow/login', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      logger.debug('Successfully navigated to Twitter login page');
    } catch (error) {
      logger.error(`Failed to navigate to Twitter login page: ${error.message}`);
      await page.screenshot({ path: path.join(logsDir, 'login-navigation-error.png') });
      throw new Error(`Failed to navigate to Twitter login page: ${error.message}`);
    }
    
    // Wait for the page to stabilize
    await page.waitForTimeout(5000);
    
    // Take a screenshot of the login page for debugging
    await page.screenshot({ path: path.join(logsDir, 'login-page-initial.png') });
    
    // Get credentials from environment variables
    const username = process.env.TWITTER_USERNAME;
    const password = process.env.TWITTER_PASSWORD;
    const email = process.env.TWITTER_EMAIL || username; // Fallback to username if email not provided
    
    if (!username || !password) {
      throw new Error('Twitter credentials not found in environment variables');
    }
    
    // Wait for username field to appear
    logger.info('Waiting for username field...');
    
    // Try different selectors for the username field
    const usernameSelectors = [
      'input[name="text"]',
      'input[autocomplete="username"]',
      'input[name="username"]',
      'input[type="text"]',
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[autocapitalize="none"]'
    ];
    
    let usernameField = null;
    
    for (const selector of usernameSelectors) {
      logger.info(`Looking for username field with selector: ${selector}`);
      try {
        usernameField = await page.waitForSelector(selector, { timeout: 5000 });
        if (usernameField) {
          logger.info(`Found username field with selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Continue to the next selector
      }
    }
    
    if (!usernameField) {
      logger.error('Could not find username field');
      await page.screenshot({ path: path.join(logsDir, 'login-username-not-found.png') });
      
      // Try to find any input field as a last resort
      logger.info('Trying to find any input field...');
      try {
        const inputs = await page.$$('input');
        if (inputs.length > 0) {
          logger.info(`Found ${inputs.length} input fields, trying the first one`);
          usernameField = inputs[0];
        }
      } catch (error) {
        logger.error(`Error finding any input fields: ${error.message}`);
      }
      
      if (!usernameField) {
        throw new Error('Could not find username field');
      }
    }
    
    // Enter username
    await usernameField.click({ clickCount: 3 }); // Select all text
    await usernameField.press('Backspace'); // Clear field
    await usernameField.type(username, { delay: 100 }); // Type with delay to appear human-like
    
    // Take a screenshot after entering username
    await page.screenshot({ path: path.join(logsDir, 'login-username-entered.png') });
    
    // Find and click the Next button
    logger.info('Looking for Next button...');
    const nextButtonSelectors = [
      'div[role="button"]:has-text("Next")',
      'span:has-text("Next")',
      'button[type="submit"]',
      'div[data-testid="ocfLoginNextButton"]',
      'div[data-testid="LoginForm_Forward_Button"]'
    ];
    
    let nextButton = null;
    
    for (const selector of nextButtonSelectors) {
      try {
        nextButton = await page.waitForSelector(selector, { timeout: 5000 });
        if (nextButton) {
          logger.info(`Found Next button with selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Continue to the next selector
      }
    }
    
    if (!nextButton) {
      logger.error('Could not find Next button');
      await page.screenshot({ path: path.join(logsDir, 'login-next-button-not-found.png') });
      throw new Error('Could not find Next button');
    }
    
    await nextButton.click();
    logger.info('Clicked Next button');
    
    // Wait for the page to update
    await page.waitForTimeout(3000);
    
    // Check if we need to enter email verification
    const emailVerificationNeeded = await page.evaluate(() => {
      return document.body.innerText.includes('Enter your phone number or username') ||
             document.body.innerText.includes('Enter your email');
    });
    
    if (emailVerificationNeeded) {
      logger.info('Email verification needed');
      
      // Try to find the email field
      const emailSelectors = [
        'input[name="text"]',
        'input[type="text"]',
        'input[autocomplete="email"]'
      ];
      
      let emailField = null;
      
      for (const selector of emailSelectors) {
        try {
          emailField = await page.waitForSelector(selector, { timeout: 5000 });
          if (emailField) {
            logger.info(`Found email field with selector: ${selector}`);
            break;
          }
        } catch (error) {
          // Continue to the next selector
        }
      }
      
      if (!emailField) {
        logger.error('Could not find email field');
        await page.screenshot({ path: path.join(logsDir, 'login-email-not-found.png') });
        throw new Error('Could not find email field');
      }
      
      // Enter email
      await emailField.click({ clickCount: 3 }); // Select all text
      await emailField.press('Backspace'); // Clear field
      await emailField.type(email, { delay: 100 }); // Type with delay
      
      // Find and click the Next button again
      for (const selector of nextButtonSelectors) {
        try {
          nextButton = await page.waitForSelector(selector, { timeout: 5000 });
          if (nextButton) {
            logger.info(`Found Next button with selector: ${selector}`);
            break;
          }
        } catch (error) {
          // Continue to the next selector
        }
      }
      
      if (!nextButton) {
        logger.error('Could not find Next button after email entry');
        await page.screenshot({ path: path.join(logsDir, 'login-next-button-after-email-not-found.png') });
        throw new Error('Could not find Next button after email entry');
      }
      
      await nextButton.click();
      logger.info('Clicked Next button after email entry');
      
      // Wait for the page to update
      await page.waitForTimeout(3000);
    }
    
    // Wait for password field
    logger.info('Waiting for password field...');
    
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]'
    ];
    
    let passwordField = null;
    
    for (const selector of passwordSelectors) {
      try {
        passwordField = await page.waitForSelector(selector, { timeout: 5000 });
        if (passwordField) {
          logger.info(`Found password field with selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Continue to the next selector
      }
    }
    
    if (!passwordField) {
      logger.error('Could not find password field');
      await page.screenshot({ path: path.join(logsDir, 'login-password-not-found.png') });
      throw new Error('Could not find password field');
    }
    
    // Enter password
    await passwordField.click({ clickCount: 3 }); // Select all text
    await passwordField.press('Backspace'); // Clear field
    await passwordField.type(password, { delay: 100 }); // Type with delay
    
    // Take a screenshot after entering password (but blur it for security)
    await page.evaluate(() => {
      const passwordFields = document.querySelectorAll('input[type="password"]');
      passwordFields.forEach(field => {
        field.style.filter = 'blur(5px)';
      });
    });
    await page.screenshot({ path: path.join(logsDir, 'login-password-entered.png') });
    
    // Find and click the Login button
    logger.info('Looking for Login button...');
    const loginButtonSelectors = [
      'div[role="button"]:has-text("Log in")',
      'span:has-text("Log in")',
      'button[type="submit"]',
      'div[data-testid="LoginForm_Login_Button"]'
    ];
    
    let loginButton = null;
    
    for (const selector of loginButtonSelectors) {
      try {
        loginButton = await page.waitForSelector(selector, { timeout: 5000 });
        if (loginButton) {
          logger.info(`Found Login button with selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Continue to the next selector
      }
    }
    
    if (!loginButton) {
      logger.error('Could not find Login button');
      await page.screenshot({ path: path.join(logsDir, 'login-button-not-found.png') });
      throw new Error('Could not find Login button');
    }
    
    await loginButton.click();
    logger.info('Clicked Login button');
    
    // Wait for login to complete
    await page.waitForTimeout(5000);
    
    // Check if login was successful
    const loginSuccessful = await page.evaluate(() => {
      return !document.body.innerText.includes('Wrong password') &&
             !document.body.innerText.includes('Incorrect password') &&
             !document.body.innerText.includes('Login failed');
    });
    
    if (!loginSuccessful) {
      logger.error('Login failed due to incorrect credentials');
      await page.screenshot({ path: path.join(logsDir, 'login-failed.png') });
      throw new Error('Login failed due to incorrect credentials');
    }
    
    // Take a screenshot of the logged-in state
    await page.screenshot({ path: path.join(logsDir, 'login-successful.png') });
    
    logger.info('Successfully logged in to Twitter');
    return { browser, page, context };
  } catch (error) {
    logger.error(`Twitter login failed: ${error.message}`);
    if (page) {
      await page.screenshot({ path: path.join(logsDir, 'error-screenshot.png') });
      logger.info('Saved error screenshot to logs/error-screenshot.png');
    }
    throw error;
  }
}

/**
 * Join a Twitter Space
 * @param {Object} browserObj - Browser object with authenticated page
 * @param {string} spaceUrl - URL of the Twitter Space to join
 * @returns {Promise<Object>} - Page with active Twitter Space
 */
async function joinTwitterSpace(browserObj, spaceUrl) {
  logger.info(`Joining Twitter Space: ${spaceUrl}`);
  
  // Extract browser components
  const { browser, page, context } = browserObj;
  
  try {
    // Navigate to the Twitter Space URL
    logger.info(`Navigating to ${spaceUrl}`);
    await page.goto(spaceUrl, { waitUntil: 'domcontentloaded' });
    
    // Wait for the page to stabilize
    logger.info('Waiting for page to stabilize...');
    await page.waitForTimeout(5000);
    
    // Take a screenshot before checking the space
    const screenshotPath = path.join(__dirname, '../../logs', `space-before-check-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath });
    logger.info(`Screenshot saved to: ${screenshotPath}`);
    
    // Check if the space is valid
    logger.info('Checking if the space is valid...');
    const isValidSpace = await page.evaluate(() => {
      // Look for elements that indicate a valid space
      const spaceTitle = document.querySelector('[data-testid="audioSpaceTitle"]');
      const spaceHost = document.querySelector('[data-testid="audioSpaceHostInfo"]');
      
      return !!spaceTitle || !!spaceHost;
    });
    
    if (!isValidSpace) {
      logger.error('Invalid Twitter Space: Space may have ended or does not exist');
      const errorScreenshotPath = path.join(__dirname, '../../logs', `invalid-space-${Date.now()}.png`);
      await page.screenshot({ path: errorScreenshotPath });
      logger.info(`Error screenshot saved to: ${errorScreenshotPath}`);
      throw new Error('Invalid Twitter Space: Space may have ended or does not exist');
    }
    
    // Check if we're already in the space
    logger.info('Checking if already in the space...');
    const alreadyInSpace = await page.evaluate(() => {
      // Look for elements that indicate we're already in the space
      const leaveButton = document.querySelector('[data-testid="leaveSpace"]');
      const audioControls = document.querySelector('[data-testid="audioSpaceControls"]');
      
      return !!leaveButton || !!audioControls;
    });
    
    if (alreadyInSpace) {
      logger.info('Already in the Twitter Space');
      return;
    }
    
    // Check for rate limiting
    const isRateLimited = await page.evaluate(() => {
      return document.body.textContent.includes('Rate limit exceeded') || 
             document.body.textContent.includes('Too many requests');
    });
    
    if (isRateLimited) {
      logger.error('Twitter rate limit exceeded. Waiting before retrying...');
      const rateLimitScreenshot = path.join(__dirname, '../../logs', `rate-limit-${Date.now()}.png`);
      await page.screenshot({ path: rateLimitScreenshot });
      logger.info(`Rate limit screenshot saved to: ${rateLimitScreenshot}`);
      
      // Wait for 2 minutes before retrying
      logger.info('Waiting for 2 minutes before retrying...');
      await page.waitForTimeout(120000);
      
      // Refresh the page and try again
      logger.info('Refreshing page to retry...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
    }
    
    // Try to find and click the "Start listening" button
    logger.info('Looking for "Start listening" button...');
    
    // Take a screenshot before clicking
    const beforeClickScreenshot = path.join(__dirname, '../../logs', `before-click-${Date.now()}.png`);
    await page.screenshot({ path: beforeClickScreenshot });
    logger.info(`Before click screenshot saved to: ${beforeClickScreenshot}`);
    
    // Try multiple selectors for the "Start listening" button
    const buttonSelectors = [
      '[data-testid="startListeningButton"]',
      'div[role="button"]:has-text("Start listening")',
      'div[role="button"]:has-text("Listen")',
      'div[data-testid="audioSpaceBarPlayButton"]'
    ];
    
    let buttonClicked = false;
    
    for (const selector of buttonSelectors) {
      try {
        logger.info(`Trying to find button with selector: ${selector}`);
        const button = await page.$(selector);
        
        if (button) {
          logger.info(`Found button with selector: ${selector}, clicking...`);
          await button.click();
          buttonClicked = true;
          logger.info('Button clicked successfully');
          break;
        }
      } catch (error) {
        logger.warn(`Failed to click button with selector ${selector}: ${error.message}`);
      }
    }
    
    // If we couldn't find the button with selectors, try a more aggressive approach
    if (!buttonClicked) {
      logger.warn('Could not find "Start listening" button with selectors, trying JavaScript click...');
      
      try {
        // Try to click any button that contains "Start listening" or "Listen" text
        buttonClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
          const listenButton = buttons.find(button => 
            button.textContent.includes('Start listening') || 
            button.textContent.includes('Listen')
          );
          
          if (listenButton) {
            listenButton.click();
            return true;
          }
          
          return false;
        });
        
        if (buttonClicked) {
          logger.info('Successfully clicked button using JavaScript');
        } else {
          logger.warn('Could not find any button with "Start listening" or "Listen" text');
        }
      } catch (error) {
        logger.error(`Error during JavaScript click: ${error.message}`);
      }
    }
    
    // Take a screenshot after clicking
    await page.waitForTimeout(2000);
    const afterClickScreenshot = path.join(__dirname, '../../logs', `after-click-${Date.now()}.png`);
    await page.screenshot({ path: afterClickScreenshot });
    logger.info(`After click screenshot saved to: ${afterClickScreenshot}`);
    
    // Wait for the space to load
    logger.info('Waiting for space to load...');
    await page.waitForTimeout(5000);
    
    // Verify we're in the space
    const inSpace = await page.evaluate(() => {
      const leaveButton = document.querySelector('[data-testid="leaveSpace"]');
      const audioControls = document.querySelector('[data-testid="audioSpaceControls"]');
      
      return !!leaveButton || !!audioControls;
    });
    
    if (!inSpace) {
      logger.warn('Could not verify that we joined the space. Taking a screenshot...');
      const verifyScreenshot = path.join(__dirname, '../../logs', `verify-join-${Date.now()}.png`);
      await page.screenshot({ path: verifyScreenshot });
      logger.info(`Verification screenshot saved to: ${verifyScreenshot}`);
    } else {
      logger.info('Successfully joined the Twitter Space');
    }
    
  } catch (error) {
    logger.error(`Error joining Twitter Space: ${error.message}`);
    const errorScreenshot = path.join(__dirname, '../../logs', `join-error-${Date.now()}.png`);
    await page.screenshot({ path: errorScreenshot }).catch(e => logger.error(`Failed to take error screenshot: ${e.message}`));
    logger.info(`Error screenshot saved to: ${errorScreenshot}`);
    throw error;
  }
}

/**
 * Check if audio is playing on the page
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if audio is playing
 */
async function checkIfAudioIsPlaying(page) {
  logger.debug('Checking if audio is playing...');
  
  try {
    // Take a screenshot for debugging
    await page.screenshot({ path: 'audio-check.png' });
    
    // Method 1: Check for audio elements that are playing
    const isPlayingByAudioElement = await page.evaluate(() => {
      const audioElements = Array.from(document.querySelectorAll('audio'));
      return audioElements.some(audio => !audio.paused && !audio.muted && audio.currentTime > 0);
    });
    
    if (isPlayingByAudioElement) {
      logger.debug('Audio is playing (detected via audio element)');
      return true;
    }
    
    // Method 2: Check for pause button which indicates audio is playing
    const hasPauseButton = await page.evaluate(() => {
      return document.querySelector('div[aria-label="Pause"]') !== null ||
             document.querySelector('div[data-testid="audioSpacePauseButton"]') !== null ||
             document.querySelector('div[role="button"]:has-text("Pause")') !== null;
    });
    
    if (hasPauseButton) {
      logger.debug('Audio is playing (detected via pause button)');
      return true;
    }
    
    // Method 3: Check for audio visualizer which indicates audio is playing
    const hasVisualizer = await page.evaluate(() => {
      return document.querySelector('div[data-testid="audioSpaceVisualizer"]') !== null ||
             document.querySelector('.visualizer-container') !== null;
    });
    
    if (hasVisualizer) {
      logger.debug('Audio is playing (detected via visualizer)');
      return true;
    }
    
    // Method 4: Check for speaker info which indicates we're in an active space
    const hasSpeakerInfo = await page.evaluate(() => {
      return document.querySelector('div[data-testid="audioSpaceSpeakerInfo"]') !== null ||
             document.querySelector('.speaker-info') !== null;
    });
    
    if (hasSpeakerInfo) {
      logger.debug('Audio might be playing (detected via speaker info)');
      return true;
    }
    
    // Method 5: Check if we're in a space at all by looking for space-specific elements
    const isInSpace = await page.evaluate(() => {
      return document.querySelector('div[data-testid="audioSpaceTitle"]') !== null ||
             document.querySelector('.space-title') !== null;
    });
    
    if (isInSpace) {
      logger.debug('In a Twitter Space, assuming audio is available');
      return true;
    }
    
    logger.debug('No indication that audio is playing');
    return false;
  } catch (error) {
    logger.error(`Error checking if audio is playing: ${error.message}`);
    return false;
  }
}

module.exports = {
  launchBrowser,
  loginToTwitter,
  joinTwitterSpace
}; 