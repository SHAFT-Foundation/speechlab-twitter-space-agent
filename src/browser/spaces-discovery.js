/**
 * Twitter Spaces Discovery Module
 * 
 * This module scrapes the Spaces Dashboard website to find active Twitter Spaces
 * and returns their details including URLs, hosts, and listener counts.
 */

const { chromium } = require('playwright');
const logger = require('../utils/logger');

/**
 * Fetch the latest Twitter Spaces from spacesdashboard.com
 * @param {Object} options - Configuration options
 * @param {string} options.mode - Mode to fetch spaces ('top', 'latest', 'all')
 * @param {string} options.query - Optional search query
 * @param {string} options.language - Optional language filter
 * @param {number} options.limit - Maximum number of spaces to fetch
 * @returns {Promise<Array>} Array of Twitter Space objects
 * @throws {Error} If no Twitter Spaces are found
 */
async function discoverTwitterSpaces(options = {}) {
  const mode = options.mode || 'top';
  const query = options.query || '';
  const language = options.language || 'en';
  const limit = options.limit || 10;
  
  logger.info(`Discovering Twitter Spaces (mode: ${mode}, query: "${query}", language: ${language}, limit: ${limit})`);
  
  let browser = null;
  
  try {
    // Launch browser with more robust settings
    browser = await chromium.launch({
      headless: true,
      timeout: 60000,
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      timeout: 60000
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    
    // Add more logging
    page.on('console', msg => {
      logger.debug(`Browser console: ${msg.text()}`);
    });
    
    // Construct URL with query parameters
    let url = `https://spacesdashboard.com/?lang=${language}&mode=${mode}`;
    if (query) {
      url += `&q=${encodeURIComponent(query)}`;
    }
    
    logger.debug(`Navigating to: ${url}`);
    
    // Use more robust navigation
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'spaces-dashboard.png' });
    logger.debug('Saved screenshot to spaces-dashboard.png');
    
    // Wait for spaces to load with a more reliable approach
    logger.debug('Waiting for spaces to load...');
    
    // First check if the page loaded at all
    const pageTitle = await page.title();
    logger.debug(`Page title: ${pageTitle}`);
    
    // Try different selectors that might indicate spaces
    const possibleSelectors = [
      '.space-card',
      '.spaces-list',
      '.space-item',
      'a[href*="/i/spaces/"]',
      'div[data-testid="spaces-card"]'
    ];
    
    let spacesFound = false;
    for (const selector of possibleSelectors) {
      logger.debug(`Trying selector: ${selector}`);
      const elements = await page.$$(selector);
      if (elements.length > 0) {
        logger.debug(`Found ${elements.length} elements with selector: ${selector}`);
        spacesFound = true;
        break;
      }
    }
    
    if (!spacesFound) {
      logger.error('No spaces found on the page.');
      throw new Error('No Twitter Spaces found on spacesdashboard.com');
    }
    
    // Extract space information
    logger.debug('Extracting space information...');
    const spaces = await page.evaluate((maxSpaces) => {
      const spaceCards = Array.from(document.querySelectorAll('.space-card, a[href*="/i/spaces/"]'));
      return spaceCards.slice(0, maxSpaces).map(card => {
        // Extract space URL
        let spaceUrl = null;
        if (card.tagName === 'A' && card.href && card.href.includes('/i/spaces/')) {
          spaceUrl = card.href;
        } else {
          const linkElement = card.querySelector('a[href*="/i/spaces/"]');
          spaceUrl = linkElement ? linkElement.href : null;
        }
        
        // Skip if no valid URL found
        if (!spaceUrl) return null;
        
        // Extract space ID from URL
        const spaceId = spaceUrl.match(/\/i\/spaces\/([^?]+)/)?.[1] || null;
        
        // Extract title
        const titleElement = card.querySelector('.space-title') || card.querySelector('h3, h4, .title');
        const title = titleElement ? titleElement.textContent.trim() : '';
        
        // Extract host
        const hostElement = card.querySelector('.space-host') || card.querySelector('.host, .username');
        const host = hostElement ? hostElement.textContent.trim() : '';
        
        // Extract listener count
        const listenerElement = card.querySelector('.space-listeners') || card.querySelector('.listeners, .count');
        const listenersText = listenerElement ? listenerElement.textContent.trim() : '0';
        const listeners = parseInt(listenersText.replace(/[^0-9]/g, '')) || 0;
        
        // Extract status (live, scheduled, etc.)
        const statusElement = card.querySelector('.space-status') || card.querySelector('.status, .state');
        const status = statusElement ? statusElement.textContent.trim() : '';
        
        // Extract timestamp
        const timeElement = card.querySelector('.space-time') || card.querySelector('.time, .timestamp');
        const timestamp = timeElement ? timeElement.textContent.trim() : '';
        
        return {
          id: spaceId,
          url: spaceUrl,
          title: title || 'Untitled Space',
          host: host || 'Unknown Host',
          listeners,
          status,
          timestamp,
          discoveredAt: new Date().toISOString()
        };
      }).filter(space => space !== null); // Filter out null entries
    }, limit);
    
    // Filter out spaces with missing URLs
    const validSpaces = spaces.filter(space => space.url && space.url.trim() !== '').map(space => {
      // Convert x.com URLs to twitter.com URLs
      if (space.url && space.url.includes('x.com/i/spaces/')) {
        space.url = space.url.replace('x.com/i/spaces/', 'twitter.com/i/spaces/');
      }
      return space;
    });
    
    if (validSpaces.length === 0) {
      logger.error('No valid Twitter Spaces found with URLs.');
      throw new Error('No valid Twitter Spaces found with URLs');
    }
    
    logger.info(`Discovered ${validSpaces.length} Twitter Spaces`);
    
    return validSpaces;
  } catch (error) {
    logger.error(`Failed to discover Twitter Spaces: ${error.message}`);
    logger.debug(error.stack);
    throw error; // Re-throw the error to fail fast
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Find the most popular Twitter Space based on listener count
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Most popular Twitter Space
 * @throws {Error} If no Twitter Spaces are found
 */
async function findMostPopularSpace(options = {}) {
  const spaces = await discoverTwitterSpaces({
    ...options,
    mode: 'top',
    limit: 20
  });
  
  if (!spaces || spaces.length === 0) {
    throw new Error('No Twitter Spaces found');
  }
  
  // Sort by listener count (descending)
  spaces.sort((a, b) => b.listeners - a.listeners);
  
  const mostPopular = spaces[0];
  if (!mostPopular) {
    throw new Error('No valid Twitter Spaces found');
  }
  
  logger.info(`Most popular Twitter Space: "${mostPopular.title}" by ${mostPopular.host} (${mostPopular.listeners} listeners)`);
  
  return mostPopular;
}

/**
 * Find Twitter Spaces matching a specific query
 * @param {string} searchQuery - Query to search for
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Array of matching Twitter Spaces
 */
async function findSpacesByQuery(searchQuery, options = {}) {
  return await discoverTwitterSpaces({
    ...options,
    query: searchQuery
  });
}

/**
 * Monitor Twitter Spaces and call a callback when new spaces are found
 * @param {Function} callback - Function to call with new spaces
 * @param {Object} options - Configuration options
 * @param {number} options.interval - Polling interval in milliseconds
 * @param {string} options.mode - Mode to fetch spaces
 * @param {string} options.query - Search query
 * @returns {Object} Monitor controller with stop method
 */
function monitorTwitterSpaces(callback, options = {}) {
  const interval = options.interval || 5 * 60 * 1000; // Default: 5 minutes
  const knownSpaceIds = new Set();
  let isRunning = true;
  
  logger.info(`Starting Twitter Spaces monitor (interval: ${interval}ms)`);
  
  // Initial discovery
  discoverTwitterSpaces(options).then(spaces => {
    // Mark initial spaces as known
    spaces.forEach(space => {
      if (space.id) {
        knownSpaceIds.add(space.id);
      }
    });
    
    // Call callback with initial spaces
    callback(spaces, { isInitial: true });
  });
  
  // Set up polling
  const timerId = setInterval(async () => {
    if (!isRunning) return;
    
    try {
      const spaces = await discoverTwitterSpaces(options);
      const newSpaces = spaces.filter(space => space.id && !knownSpaceIds.has(space.id));
      
      // Update known space IDs
      spaces.forEach(space => {
        if (space.id) {
          knownSpaceIds.add(space.id);
        }
      });
      
      if (newSpaces.length > 0) {
        logger.info(`Found ${newSpaces.length} new Twitter Spaces`);
        callback(newSpaces, { isInitial: false });
      }
    } catch (error) {
      logger.error(`Error in Twitter Spaces monitor: ${error.message}`);
    }
  }, interval);
  
  // Return controller
  return {
    stop: () => {
      logger.info('Stopping Twitter Spaces monitor');
      isRunning = false;
      clearInterval(timerId);
    }
  };
}

module.exports = {
  discoverTwitterSpaces,
  findMostPopularSpace,
  findSpacesByQuery,
  monitorTwitterSpaces
}; 