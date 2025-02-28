#!/usr/bin/env node

/**
 * Twitter Spaces Discovery CLI Tool
 * 
 * This tool discovers active Twitter Spaces from spacesdashboard.com
 * and can be used to find spaces to monitor with the audio capture tool.
 */

require('dotenv').config();
const { Command } = require('commander');
const logger = require('./utils/logger');
const { 
  discoverTwitterSpaces, 
  findMostPopularSpace,
  findSpacesByQuery,
  monitorTwitterSpaces 
} = require('./browser/spaces-discovery');
const fs = require('fs');
const path = require('path');

// CLI configuration
const program = new Command();
program
  .name('discover-spaces')
  .description('Discover active Twitter Spaces from spacesdashboard.com')
  .version('1.0.0')
  .option('-m, --mode <mode>', 'Mode to fetch spaces (top, latest, all)', 'top')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --language <lang>', 'Language filter', 'en')
  .option('-n, --limit <number>', 'Maximum number of spaces to fetch', '10')
  .option('-o, --output <file>', 'Output file for results (JSON format)')
  .option('-p, --popular', 'Find the most popular space')
  .option('-w, --watch', 'Monitor for new spaces')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds (for watch mode)', '300000')
  .option('-a, --auto-capture', 'Automatically start capturing the most popular space')
  .option('-d, --debug', 'Enable debug logging')
  .parse(process.argv);

const options = program.opts();

// Configure logger based on debug flag
if (options.debug) {
  logger.level = 'debug';
}

/**
 * Format space information for display
 * @param {Object} space - Twitter Space object
 * @returns {string} Formatted string
 */
function formatSpace(space) {
  return `
${space.title}
URL: ${space.url}
Host: ${space.host}
Listeners: ${space.listeners}
Status: ${space.status}
${space.timestamp ? `Time: ${space.timestamp}` : ''}
`;
}

/**
 * Save spaces to a JSON file
 * @param {Array} spaces - Array of Twitter Space objects
 * @param {string} filePath - Output file path
 */
function saveSpacesToFile(spaces, filePath) {
  try {
    const outputDir = path.dirname(filePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(
      filePath,
      JSON.stringify(spaces, null, 2),
      'utf8'
    );
    
    logger.info(`Saved ${spaces.length} spaces to ${filePath}`);
  } catch (error) {
    logger.error(`Failed to save spaces to file: ${error.message}`);
  }
}

/**
 * Start capturing a Twitter Space
 * @param {Object} space - Twitter Space to capture
 */
function startCapturingSpace(space) {
  logger.info(`Starting capture of Twitter Space: "${space.title}"`);
  
  // Build the command to run the capture tool
  const captureCommand = `node ${path.join(__dirname, 'index.js')} --url ${space.url} --test-mode`;
  
  // Execute the command
  const { spawn } = require('child_process');
  const captureProcess = spawn('node', [
    path.join(__dirname, 'index.js'),
    '--url', space.url,
    '--test-mode'
  ], {
    detached: true,
    stdio: 'inherit'
  });
  
  captureProcess.on('error', (error) => {
    logger.error(`Failed to start capture process: ${error.message}`);
  });
  
  logger.info(`Capture process started with PID: ${captureProcess.pid}`);
}

/**
 * Main function
 */
async function main() {
  try {
    // Find the most popular space
    if (options.popular) {
      logger.info('Finding the most popular Twitter Space...');
      const popularSpace = await findMostPopularSpace({
        language: options.language
      });
      
      if (popularSpace) {
        console.log('Most Popular Twitter Space:');
        console.log(formatSpace(popularSpace));
        
        if (options.output) {
          saveSpacesToFile([popularSpace], options.output);
        }
        
        if (options.autoCapture) {
          startCapturingSpace(popularSpace);
        }
      } else {
        console.log('No Twitter Spaces found.');
      }
      return;
    }
    
    // Monitor for new spaces
    if (options.watch) {
      logger.info(`Monitoring for Twitter Spaces (mode: ${options.mode}, query: "${options.query || ''}")`);
      console.log('Press Ctrl+C to stop monitoring.');
      
      const monitor = monitorTwitterSpaces((spaces, info) => {
        if (info.isInitial) {
          console.log(`\nFound ${spaces.length} initial spaces:`);
        } else {
          console.log(`\nFound ${spaces.length} new spaces:`);
        }
        
        spaces.forEach(space => {
          console.log(formatSpace(space));
        });
        
        if (options.output) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const outputFile = options.output.replace(
            /\.json$/i,
            `-${timestamp}.json`
          );
          saveSpacesToFile(spaces, outputFile);
        }
        
        // Auto-capture the most popular new space if requested
        if (options.autoCapture && spaces.length > 0 && !info.isInitial) {
          const mostPopular = [...spaces].sort((a, b) => b.listeners - a.listeners)[0];
          startCapturingSpace(mostPopular);
        }
      }, {
        mode: options.mode,
        query: options.query,
        language: options.language,
        limit: parseInt(options.limit),
        interval: parseInt(options.interval)
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        monitor.stop();
        console.log('\nMonitoring stopped.');
        process.exit(0);
      });
      
      return;
    }
    
    // Default: one-time discovery
    logger.info(`Discovering Twitter Spaces (mode: ${options.mode}, query: "${options.query || ''}")`);
    
    const spaces = await discoverTwitterSpaces({
      mode: options.mode,
      query: options.query,
      language: options.language,
      limit: parseInt(options.limit)
    });
    
    if (spaces.length > 0) {
      console.log(`Found ${spaces.length} Twitter Spaces:`);
      spaces.forEach(space => {
        console.log(formatSpace(space));
      });
      
      if (options.output) {
        saveSpacesToFile(spaces, options.output);
      }
      
      if (options.autoCapture && spaces.length > 0) {
        const mostPopular = [...spaces].sort((a, b) => b.listeners - a.listeners)[0];
        startCapturingSpace(mostPopular);
      }
    } else {
      console.log('No Twitter Spaces found.');
    }
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    logger.debug(error.stack);
    process.exit(1);
  }
}

// Run the main function
main();