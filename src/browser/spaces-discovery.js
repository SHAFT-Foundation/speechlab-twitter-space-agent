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
 */
async function discoverTwitterSpaces(options = {}) {
  const mode = options.mode || 'top';
  const query = options.query || '';
  const language = options.language || 'en';
  const limit = options.limit || 10;
  
  logger.info(`Discovering Twitter Spaces (mode: ${mode}, query: "${query}", language: ${language}, limit: ${limit})`);
  
  let browser = null;
  
  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Construct URL with query parameters
    let url = `https://spacesdashboard.com/?lang=${language}&mode=${mode}`;
    if (query) {
      url += `&q=${encodeURIComponent(query)}`;
    }
    
    logger.debug(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Wait for spaces to load
    logger.debug('Waiting for spaces to load...');
    await page.waitForSelector('.space-card', { timeout: 30000 });
    
    // Extract space information
    logger.debug('Extracting space information...');
    const spaces = await page.evaluate((maxSpaces) => {
      const spaceCards = Array.from(document.querySelectorAll('.space-card'));
      return spaceCards.slice(0, maxSpaces).map(card => {
        // Extract space URL
        const linkElement = card.querySelector('a[href*="/i/spaces/"]');
        const spaceUrl = linkElement ? linkElement.href : null;
        
        // Extract space ID from URL
        const spaceId = spaceUrl ? spaceUrl.match(/\/i\/spaces\/([^?]+)/)?.[1] : null;
        
        // Extract title
        const titleElement = card.querySelector('.space-title');
        const title = titleElement ? titleElement.textContent.trim() : 'Untitled Space';
        
        // Extract host
        const hostElement = card.querySelector('.space-host');
        const host = hostElement ? hostElement.textContent.trim() : 'Unknown Host';
        
        // Extract listener count
        const listenerElement = card.querySelector('.space-listeners');
        const listenersText = listenerElement ? listenerElement.textContent.trim() : '0';
        const listeners = parseInt(listenersText.replace(/[^0-9]/g, '')) || 0;
        
        // Extract status (live, scheduled, etc.)
        const statusElement = card.querySelector('.space-status');
        const status = statusElement ? statusElement.textContent.trim() : 'unknown';
        
        // Extract timestamp
        const timeElement = card.querySelector('.space-time');
        const timestamp = timeElement ? timeElement.textContent.trim() : '';
        
        return {
          id: spaceId,
          url: spaceUrl,
          title,
          host,
          listeners,
          status,
          timestamp,
          discoveredAt: new Date().toISOString()
        };
      });
    }, limit);
    
    // Filter out spaces with missing URLs
    const validSpaces = spaces.filter(space => space.url);
    
    logger.info(`Discovered ${validSpaces.length} Twitter Spaces`);
    
    return validSpaces;
  } catch (error) {
    logger.error(`Failed to discover Twitter Spaces: ${error.message}`);
    logger.debug(error.stack);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Find the most popular Twitter Space based on listener count
 * @param {Object} options - Configuration options
 * @returns {Promise<Object|null>} Most popular Twitter Space or null if none found
 */
async function findMostPopularSpace(options = {}) {
  const spaces = await discoverTwitterSpaces({
    ...options,
    mode: 'top',
    limit: 20
  });
  
  if (spaces.length === 0) {
    logger.warn('No Twitter Spaces found');
    return null;
  }
  
  // Sort by listener count (descending)
  spaces.sort((a, b) => b.listeners - a.listeners);
  
  const mostPopular = spaces[0];
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