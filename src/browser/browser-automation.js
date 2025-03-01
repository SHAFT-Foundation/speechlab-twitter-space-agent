const { chromium } = require('playwright');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

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
  const { page } = browserObj;
  logger.info(`Joining Twitter Space: ${spaceUrl}`);
  
  try {
    // Normalize URL (convert x.com to twitter.com if needed and remove /peek suffix)
    let normalizedUrl = spaceUrl.replace('x.com', 'twitter.com');
    normalizedUrl = normalizedUrl.replace('/peek', '');
    
    logger.info(`Normalized URL: ${normalizedUrl}`);
    
    // Navigate to the Twitter Space with a more reliable approach
    logger.info(`Navigating to Twitter Space...`);
    try {
      // First try with domcontentloaded which is faster
      await page.goto(normalizedUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      logger.info('Page loaded with domcontentloaded event');
    } catch (navError) {
      logger.warn(`Navigation with domcontentloaded failed: ${navError.message}`);
      // If that fails, try with load event
      await page.goto(normalizedUrl, { 
        waitUntil: 'load',
        timeout: 60000 
      });
      logger.info('Page loaded with load event');
    }
    
    // Wait for the page to stabilize
    logger.info('Waiting for page to stabilize...');
    await page.waitForTimeout(5000);
    
    // Check if the Twitter Space is valid
    const isValidSpace = await page.evaluate(() => {
      return !document.body.innerText.includes('This space has ended') && 
             !document.body.innerText.includes('Space not found') &&
             !document.body.innerText.includes('This space is unavailable');
    });
    
    if (!isValidSpace) {
      throw new Error('Invalid Twitter Space: Space has ended or does not exist');
    }
    
    logger.info('Twitter Space is valid');
    
    // Take a screenshot before clicking the button
    const screenshotPath = path.join(__dirname, '../../logs', `before-click-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath });
    logger.info(`Screenshot saved to: ${screenshotPath}`);
    
    // Find and click the "Start listening" button with multiple approaches
    logger.info('Looking for "Start listening" button...');
    
    // Dump the page HTML for debugging
    const pageContent = await page.content();
    fs.writeFileSync(path.join(__dirname, '../../logs', `page-content-${Date.now()}.html`), pageContent);
    logger.info('Saved page content to logs for debugging');
    
    // Log all buttons on the page for debugging
    const buttonInfo = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('div[role="button"], button, [tabindex="0"]');
      console.log(`Found ${allButtons.length} total interactive elements on the page`);
      
      const buttonDetails = [];
      Array.from(allButtons).forEach((btn, index) => {
        const rect = btn.getBoundingClientRect();
        const details = {
          index,
          text: btn.innerText.trim(),
          ariaLabel: btn.getAttribute('aria-label'),
          dataTestId: btn.getAttribute('data-testid'),
          className: btn.className,
          tagName: btn.tagName,
          visible: rect.width > 0 && rect.height > 0 && 
                  window.getComputedStyle(btn).display !== 'none' &&
                  window.getComputedStyle(btn).visibility !== 'hidden',
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height
        };
        console.log(`Element ${index}:`, details);
        buttonDetails.push(details);
      });
      
      return buttonDetails;
    });
    
    logger.info(`Found ${buttonInfo.length} interactive elements on the page`);
    
    // Enhanced selectors for the button with more specific targeting
    const buttonSelectors = [
      '[data-testid="startListeningButton"]',
      '[data-testid*="startListening"]',
      '[data-testid*="join"]',
      '[data-testid*="listen"]',
      'div[role="button"]:has-text("Start listening")',
      'div[role="button"]:has-text("Listen")',
      'div[role="button"]:has-text("Join Space")',
      'div[role="button"]:has-text("Join this Space")',
      'div[role="button"]:has-text("Join")',
      '[aria-label*="listen"]',
      '[aria-label*="join"]',
      '[aria-label*="space"]',
      'div[role="button"][tabindex="0"]'
    ];
    
    let buttonFound = false;
    let clickAttempts = 0;
    const maxClickAttempts = 3;
    
    // APPROACH 1: Try to find and click the button using waitForSelector with longer timeout
    logger.info('APPROACH 1: Using waitForSelector with longer timeout');
    for (const selector of buttonSelectors) {
      if (buttonFound) break;
      
      try {
        logger.info(`Waiting for selector: ${selector}`);
        const button = await page.waitForSelector(selector, { 
          timeout: 10000, 
          state: 'visible' 
        });
        
        if (button) {
          logger.info(`Found button with selector: ${selector}`);
          
          // Take a screenshot of the button
          await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) {
              btn.style.border = '5px solid red';
            }
          }, selector);
          
          await page.screenshot({ path: path.join(__dirname, '../../logs', `found-button-${Date.now()}.png`) });
          
          // Try multiple click methods
          for (let attempt = 0; attempt < maxClickAttempts; attempt++) {
            clickAttempts++;
            try {
              if (attempt === 0) {
                // First try: normal click
                await button.click({ timeout: 5000 });
                logger.info(`Clicked button with selector: ${selector} (normal click)`);
              } else if (attempt === 1) {
                // Second try: force click
                await button.click({ force: true, timeout: 5000 });
                logger.info(`Clicked button with selector: ${selector} (force click)`);
              } else {
                // Third try: JavaScript click
                await page.evaluate((sel) => {
                  const btn = document.querySelector(sel);
                  if (btn) {
                    btn.click();
                    console.log(`JavaScript click on button with selector: ${sel}`);
                  }
                }, selector);
                logger.info(`Clicked button with selector: ${selector} (JavaScript click)`);
              }
              
              // Wait a moment to see if the click had an effect
              await page.waitForTimeout(2000);
              
              // Check if audio elements appeared after the click
              const audioElementsAppeared = await page.evaluate(() => {
                return document.querySelectorAll('audio, video').length > 0;
              });
              
              if (audioElementsAppeared) {
                logger.info('Audio elements appeared after click, button click was successful');
                buttonFound = true;
                break;
              }
            } catch (clickError) {
              logger.warn(`Click attempt ${attempt + 1} failed for selector ${selector}: ${clickError.message}`);
            }
          }
          
          if (buttonFound) break;
        }
      } catch (error) {
        logger.warn(`Error with selector ${selector}: ${error.message}`);
      }
    }
    
    // APPROACH 2: If no button found with waitForSelector, try direct selection and multiple click methods
    if (!buttonFound) {
      logger.info('APPROACH 2: Using direct selection and multiple click methods');
      for (const selector of buttonSelectors) {
        if (buttonFound) break;
        
        try {
          const button = await page.$(selector);
          if (button) {
            logger.info(`Found button with direct selector: ${selector}`);
            
            // Get button text and position for logging
            const buttonDetails = await page.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return {
                text: el.innerText.trim(),
                ariaLabel: el.getAttribute('aria-label'),
                dataTestId: el.getAttribute('data-testid'),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                visible: rect.width > 0 && rect.height > 0 && 
                        window.getComputedStyle(el).display !== 'none' &&
                        window.getComputedStyle(el).visibility !== 'hidden'
              };
            }, button);
            
            logger.info(`Button details: ${JSON.stringify(buttonDetails)}`);
            
            // Try multiple click methods
            for (let attempt = 0; attempt < maxClickAttempts; attempt++) {
              clickAttempts++;
              try {
                if (attempt === 0) {
                  // First try: normal click
                  await button.click({ timeout: 5000 });
                  logger.info(`Clicked button with selector: ${selector} (normal click)`);
                } else if (attempt === 1) {
                  // Second try: force click
                  await button.click({ force: true, timeout: 5000 });
                  logger.info(`Clicked button with selector: ${selector} (force click)`);
                } else {
                  // Third try: JavaScript click
                  await page.evaluate((sel) => {
                    const btn = document.querySelector(sel);
                    if (btn) {
                      btn.click();
                      console.log(`JavaScript click on button with selector: ${sel}`);
                    }
                  }, selector);
                  logger.info(`Clicked button with selector: ${selector} (JavaScript click)`);
                }
                
                // Wait a moment to see if the click had an effect
                await page.waitForTimeout(2000);
                
                // Check if audio elements appeared after the click
                const audioElementsAppeared = await page.evaluate(() => {
                  return document.querySelectorAll('audio, video').length > 0;
                });
                
                if (audioElementsAppeared) {
                  logger.info('Audio elements appeared after click, button click was successful');
                  buttonFound = true;
                  break;
                }
              } catch (clickError) {
                logger.warn(`Click attempt ${attempt + 1} failed for selector ${selector}: ${clickError.message}`);
              }
            }
            
            if (buttonFound) break;
          }
        } catch (error) {
          logger.warn(`Error with direct selector ${selector}: ${error.message}`);
        }
      }
    }
    
    // APPROACH 3: Try to find buttons by text content
    if (!buttonFound) {
      logger.info('APPROACH 3: Finding buttons by text content');
      
      try {
        // Look for buttons by their text content
        const buttonTexts = ['Start listening', 'Listen', 'Join Space', 'Join this Space', 'Join'];
        
        for (const text of buttonTexts) {
          if (buttonFound) break;
          
          logger.info(`Looking for button with text: "${text}"`);
          
          // Use evaluate to find elements containing the text
          const matchingElements = await page.evaluate((searchText) => {
            // Get all elements that might be clickable
            const elements = Array.from(document.querySelectorAll('div, button, span, a'));
            
            // Filter elements that contain the text
            return elements
              .filter(el => {
                const elementText = el.innerText.trim();
                return elementText.includes(searchText);
              })
              .map((el, index) => {
                const rect = el.getBoundingClientRect();
                return {
                  index,
                  text: el.innerText.trim(),
                  tagName: el.tagName,
                  className: el.className,
                  id: el.id,
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  visible: rect.width > 0 && rect.height > 0 && 
                          window.getComputedStyle(el).display !== 'none' &&
                          window.getComputedStyle(el).visibility !== 'hidden'
                };
              })
              .filter(el => el.visible)
              .sort((a, b) => (b.width * b.height) - (a.width * a.height)); // Sort by size, largest first
          }, text);
          
          logger.info(`Found ${matchingElements.length} elements containing text "${text}"`);
          
          // Try to click each matching element
          for (const elementInfo of matchingElements) {
            if (buttonFound) break;
            
            logger.info(`Attempting to click element: ${JSON.stringify(elementInfo)}`);
            
            try {
              // Click using JavaScript by coordinates
              await page.evaluate((info) => {
                // Find elements at this position
                const elementsAtPoint = document.elementsFromPoint(
                  info.x + (info.width / 2),
                  info.y + (info.height / 2)
                );
                
                if (elementsAtPoint.length > 0) {
                  console.log(`Found ${elementsAtPoint.length} elements at position`);
                  // Click all elements at this point, starting from the top
                  elementsAtPoint.forEach(el => {
                    try {
                      el.click();
                      console.log(`Clicked element: ${el.tagName} with text "${el.innerText}"`);
                    } catch (e) {
                      console.error(`Error clicking element: ${e.message}`);
                    }
                  });
                  return true;
                }
                return false;
              }, elementInfo);
              
              // Wait a moment to see if the click had an effect
              await page.waitForTimeout(2000);
              
              // Check if audio elements appeared after the click
              const audioElementsAppeared = await page.evaluate(() => {
                return document.querySelectorAll('audio, video').length > 0;
              });
              
              if (audioElementsAppeared) {
                logger.info('Audio elements appeared after click, button click was successful');
                buttonFound = true;
                break;
              }
            } catch (clickError) {
              logger.warn(`Error clicking element with text "${text}": ${clickError.message}`);
            }
          }
        }
      } catch (error) {
        logger.warn(`Error in text-based button search: ${error.message}`);
      }
    }
    
    // APPROACH 4: Last resort - click the largest visible button
    if (!buttonFound) {
      logger.info('APPROACH 4: Clicking the largest visible button');
      
      try {
        // Find all visible buttons and sort by size
        const visibleButtons = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('div[role="button"], button, [tabindex="0"]'))
            .map((btn, index) => {
              const rect = btn.getBoundingClientRect();
              return {
                index,
                text: btn.innerText.trim(),
                tagName: btn.tagName,
                className: btn.className,
                id: btn.id,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                area: rect.width * rect.height,
                visible: rect.width > 0 && rect.height > 0 && 
                        window.getComputedStyle(btn).display !== 'none' &&
                        window.getComputedStyle(btn).visibility !== 'hidden'
              };
            })
            .filter(btn => btn.visible && btn.area > 0)
            .sort((a, b) => b.area - a.area); // Sort by area, largest first
        });
        
        logger.info(`Found ${visibleButtons.length} visible buttons, sorted by size`);
        
        // Log the top 5 buttons
        visibleButtons.slice(0, 5).forEach((btn, i) => {
          logger.info(`Button ${i}: area=${btn.area}, text="${btn.text}", position=(${btn.x},${btn.y})`);
        });
        
        // Try to click each of the top 5 buttons
        for (let i = 0; i < Math.min(5, visibleButtons.length); i++) {
          if (buttonFound) break;
          
          const buttonInfo = visibleButtons[i];
          logger.info(`Attempting to click button ${i}: ${JSON.stringify(buttonInfo)}`);
          
          try {
            // Click using page.mouse at the center of the button
            await page.mouse.click(
              buttonInfo.x + (buttonInfo.width / 2),
              buttonInfo.y + (buttonInfo.height / 2)
            );
            logger.info(`Clicked at position (${buttonInfo.x + (buttonInfo.width / 2)}, ${buttonInfo.y + (buttonInfo.height / 2)})`);
            
            // Wait a moment to see if the click had an effect
            await page.waitForTimeout(2000);
            
            // Check if audio elements appeared after the click
            const audioElementsAppeared = await page.evaluate(() => {
              return document.querySelectorAll('audio, video').length > 0;
            });
            
            if (audioElementsAppeared) {
              logger.info('Audio elements appeared after click, button click was successful');
              buttonFound = true;
              break;
            }
          } catch (clickError) {
            logger.warn(`Error clicking button ${i}: ${clickError.message}`);
          }
        }
      } catch (error) {
        logger.warn(`Error in largest button approach: ${error.message}`);
      }
    }
    
    // APPROACH 5: Try clicking at common positions where the button might be
    if (!buttonFound) {
      logger.info('APPROACH 5: Clicking at common positions');
      
      try {
        // Get viewport size
        const viewportSize = await page.evaluate(() => {
          return {
            width: window.innerWidth,
            height: window.innerHeight
          };
        });
        
        // Define common positions where the button might be (center, center-right, etc.)
        const commonPositions = [
          { x: viewportSize.width / 2, y: viewportSize.height / 2 }, // Center
          { x: viewportSize.width * 0.75, y: viewportSize.height / 2 }, // Center-right
          { x: viewportSize.width / 2, y: viewportSize.height * 0.75 }, // Center-bottom
          { x: viewportSize.width * 0.75, y: viewportSize.height * 0.75 }, // Bottom-right
          { x: viewportSize.width * 0.25, y: viewportSize.height / 2 } // Center-left
        ];
        
        for (const position of commonPositions) {
          if (buttonFound) break;
          
          logger.info(`Clicking at position (${position.x}, ${position.y})`);
          
          try {
            await page.mouse.click(position.x, position.y);
            
            // Wait a moment to see if the click had an effect
            await page.waitForTimeout(2000);
            
            // Check if audio elements appeared after the click
            const audioElementsAppeared = await page.evaluate(() => {
              return document.querySelectorAll('audio, video').length > 0;
            });
            
            if (audioElementsAppeared) {
              logger.info('Audio elements appeared after click, button click was successful');
              buttonFound = true;
              break;
            }
          } catch (clickError) {
            logger.warn(`Error clicking at position (${position.x}, ${position.y}): ${clickError.message}`);
          }
        }
      } catch (error) {
        logger.warn(`Error in common positions approach: ${error.message}`);
      }
    }
    
    if (!buttonFound) {
      logger.warn(`No button successfully clicked after ${clickAttempts} attempts`);
      logger.warn('The space might already be joined or requires different interaction');
    } else {
      logger.info('Successfully clicked the "Start listening" button');
    }
    
    // Wait for audio to initialize
    logger.info('Waiting for audio to initialize...');
    await page.waitForTimeout(8000);
    
    // Add code to ensure audio is unmuted and at maximum volume
    logger.info('Ensuring audio is unmuted and at maximum volume...');
    await page.evaluate(() => {
      // Find all audio and video elements
      const mediaElements = Array.from(document.querySelectorAll('audio, video'));
      console.log(`Found ${mediaElements.length} media elements`);
      
      // Unmute and set volume to max for all media elements
      mediaElements.forEach((element, index) => {
        try {
          // Force unmute
          element.muted = false;
          // Set volume to maximum
          element.volume = 1.0;
          // Try to play if paused
          if (element.paused) {
            element.play().catch(e => console.log(`Could not play element ${index}: ${e.message}`));
          }
          console.log(`Configured media element ${index}: muted=${element.muted}, volume=${element.volume}, paused=${element.paused}`);
        } catch (err) {
          console.log(`Error configuring media element ${index}: ${err.message}`);
        }
      });
      
      // Try to find and click any volume controls on the page
      const volumeControls = Array.from(document.querySelectorAll(
        '[aria-label*="volume"], [data-testid*="volume"], [class*="volume"], [title*="volume"]'
      ));
      
      console.log(`Found ${volumeControls.length} potential volume controls`);
      
      volumeControls.forEach((control, index) => {
        try {
          // Try to click the control to ensure it's activated
          control.click();
          console.log(`Clicked volume control ${index}`);
        } catch (err) {
          console.log(`Error clicking volume control ${index}: ${err.message}`);
        }
      });
      
      // Try to find and click any unmute buttons
      const muteButtons = Array.from(document.querySelectorAll(
        '[aria-label*="mute"], [data-testid*="mute"], [class*="mute"], [title*="mute"]'
      ));
      
      console.log(`Found ${muteButtons.length} potential mute/unmute buttons`);
      
      muteButtons.forEach((button, index) => {
        try {
          // Check if this is a mute button (not unmute)
          const isMuteButton = button.getAttribute('aria-label')?.includes('mute') && 
                              !button.getAttribute('aria-label')?.includes('unmute');
          
          if (isMuteButton) {
            // Don't click mute buttons
            console.log(`Skipping mute button ${index}`);
          } else {
            // Click unmute buttons
            button.click();
            console.log(`Clicked unmute button ${index}`);
          }
        } catch (err) {
          console.log(`Error interacting with mute/unmute button ${index}: ${err.message}`);
        }
      });
      
      return {
        mediaElementsCount: mediaElements.length,
        volumeControlsCount: volumeControls.length,
        muteButtonsCount: muteButtons.length
      };
    });
    
    // Check if audio is playing
    logger.info('Checking if audio is playing...');
    const isAudioPlaying = await checkIfAudioIsPlaying(page);
    
    if (isAudioPlaying) {
      logger.info('Audio is playing in the Twitter Space');
    } else {
      logger.warn('No audio detected in the Twitter Space');
      
      // Try to find and click any play buttons
      logger.info('Trying to find and click play buttons...');
      await page.evaluate(() => {
        const playButtons = Array.from(document.querySelectorAll(
          '[aria-label*="play"], [data-testid*="play"], [class*="play"], [title*="play"]'
        ));
        
        console.log(`Found ${playButtons.length} potential play buttons`);
        
        playButtons.forEach((button, index) => {
          try {
            button.click();
            console.log(`Clicked play button ${index}`);
          } catch (err) {
            console.log(`Error clicking play button ${index}: ${err.message}`);
          }
        });
      });
      
      // Wait a bit and check again
      await page.waitForTimeout(3000);
      const isAudioPlayingNow = await checkIfAudioIsPlaying(page);
      
      if (isAudioPlayingNow) {
        logger.info('Audio is now playing after clicking play buttons');
      } else {
        logger.warn('Still no audio detected after attempting to click play buttons');
      }
    }
    
    // Take another screenshot after joining
    const afterScreenshotPath = path.join(__dirname, '../../logs', `after-join-${Date.now()}.png`);
    await page.screenshot({ path: afterScreenshotPath });
    logger.info(`Screenshot after joining saved to: ${afterScreenshotPath}`);
    
    logger.info('Successfully joined Twitter Space');
    
    return { page, spaceUrl: normalizedUrl };
  } catch (error) {
    logger.error(`Failed to join Twitter Space: ${error.message}`);
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

async function setupWebSocketConnection(page, websocketEndpoint, audioMetadata) {
  const logger = getLogger();
  logger.info(`Connecting to WebSocket endpoint: ${websocketEndpoint}`);
  
  let reconnectAttempt = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 2000; // 2 seconds
  
  async function connectWebSocket() {
    reconnectAttempt++;
    logger.info(`Attempting WebSocket connection to ${websocketEndpoint} (attempt ${reconnectAttempt}/${maxReconnectAttempts})`);
    
    try {
      // Check if the WebSocket endpoint is valid before attempting to connect
      if (!websocketEndpoint.startsWith('ws://') && !websocketEndpoint.startsWith('wss://')) {
        throw new Error(`Invalid WebSocket URL: ${websocketEndpoint}. Must start with ws:// or wss://`);
      }
      
      // Create WebSocket connection in the page context
      const wsConnected = await page.evaluate(async (endpoint, metadata, attempt) => {
        try {
          window.webSocket = new WebSocket(endpoint);
          
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`WebSocket connection timeout (attempt ${attempt})`));
            }, 10000); // 10 second timeout
            
            window.webSocket.onopen = () => {
              clearTimeout(timeout);
              console.log(`WebSocket connection established (attempt ${attempt})`);
              
              // Send metadata immediately after connection
              if (metadata) {
                try {
                  window.webSocket.send(JSON.stringify({
                    type: 'metadata',
                    data: metadata
                  }));
                  console.log('Sent audio metadata to WebSocket server');
                } catch (err) {
                  console.error('Error sending metadata:', err);
                }
              }
              
              resolve(true);
            };
            
            window.webSocket.onerror = (error) => {
              clearTimeout(timeout);
              console.error(`WebSocket error (attempt ${attempt}):`, error);
              reject(new Error(`WebSocket connection error (attempt ${attempt})`));
            };
            
            window.webSocket.onclose = (event) => {
              console.log(`WebSocket connection closed: Code ${event.code}, Reason: ${event.reason}`);
              // Don't reject here as this might be called after onopen
              if (!event.wasClean) {
                window.wsReconnectNeeded = true;
              }
            };
          });
        } catch (err) {
          console.error(`Error creating WebSocket (attempt ${attempt}):`, err);
          return false;
        }
      }, websocketEndpoint, audioMetadata, reconnectAttempt);
      
      if (wsConnected) {
        logger.info('WebSocket connection established successfully');
        
        // Setup heartbeat to keep connection alive
        await page.evaluate(() => {
          window.heartbeatInterval = setInterval(() => {
            if (window.webSocket && window.webSocket.readyState === WebSocket.OPEN) {
              try {
                window.webSocket.send(JSON.stringify({ type: 'heartbeat' }));
                console.log('Sent heartbeat to WebSocket server');
              } catch (err) {
                console.error('Error sending heartbeat:', err);
              }
            }
          }, 30000); // Send heartbeat every 30 seconds
        });
        
        return true;
      } else {
        throw new Error('Failed to establish WebSocket connection');
      }
    } catch (error) {
      logger.error(`Failed to connect WebSocket: ${error.message}`);
      
      if (reconnectAttempt < maxReconnectAttempts) {
        logger.info(`Attempting to reconnect (${reconnectAttempt}/${maxReconnectAttempts}) in ${reconnectDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, reconnectDelay));
        return connectWebSocket(); // Recursive call to retry
      } else {
        logger.error(`Maximum reconnect attempts (${maxReconnectAttempts}) reached. Giving up.`);
        // Continue with local recording even if WebSocket fails
        logger.info('Continuing with local recording only');
        return false;
      }
    }
  }
  
  // Initial connection attempt
  const connected = await connectWebSocket();
  
  // Setup reconnection logic
  if (connected) {
    await page.evaluate(() => {
      // Check connection status periodically
      window.reconnectCheckInterval = setInterval(() => {
        if (window.wsReconnectNeeded || 
            (window.webSocket && window.webSocket.readyState !== WebSocket.OPEN)) {
          window.wsReconnectNeeded = false;
          console.log('WebSocket reconnection needed');
          window.dispatchEvent(new CustomEvent('websocket-reconnect-needed'));
        }
      }, 5000); // Check every 5 seconds
    });
    
    // Listen for reconnection events
    await page.exposeFunction('requestWebSocketReconnect', async () => {
      logger.info('Reconnection requested by page');
      await connectWebSocket();
    });
    
    await page.evaluate(() => {
      window.addEventListener('websocket-reconnect-needed', () => {
        window.requestWebSocketReconnect();
      });
    });
  }
  
  logger.info('WebSocket connection setup complete');
  return connected;
}

module.exports = {
  launchBrowser,
  loginToTwitter,
  joinTwitterSpace
}; 