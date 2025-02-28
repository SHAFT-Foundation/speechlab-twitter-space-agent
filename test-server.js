#!/usr/bin/env node

/**
 * Simple WebSocket server for testing audio streaming
 * This server receives audio chunks from the Twitter Space capture tool
 * and saves them to a file.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'test-server.log' })
  ]
});

// Configuration
const PORT = process.env.PORT || 8080;
const SAVE_AUDIO = true;
const OUTPUT_DIR = path.join(__dirname, 'received-audio');

// Ensure output directory exists
if (SAVE_AUDIO && !fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

logger.info(`WebSocket server started on port ${PORT}`);
logger.info(`Waiting for connections...`);

// Handle connections
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  logger.info(`New connection from ${clientIp}`);
  
  // Create a file stream for saving audio if enabled
  let fileStream = null;
  let audioFormat = 'wav';
  let receivedChunks = 0;
  let totalBytes = 0;
  let sessionStartTime = new Date();
  let sessionId = Date.now().toString();
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      // Parse the message
      const data = JSON.parse(message);
      
      // Handle different message types
      switch (data.type) {
        case 'metadata':
          logger.info(`Received metadata: ${JSON.stringify(data)}`);
          audioFormat = data.format || 'wav';
          
          // Create output file if saving is enabled
          if (SAVE_AUDIO) {
            const fileName = `twitter-space-${sessionId}.${audioFormat}`;
            const filePath = path.join(OUTPUT_DIR, fileName);
            logger.info(`Saving audio to: ${filePath}`);
            fileStream = fs.createWriteStream(filePath, { encoding: 'binary' });
          }
          
          // Send acknowledgement
          ws.send(JSON.stringify({
            type: 'metadata_ack',
            status: 'ok',
            sessionId: sessionId
          }));
          break;
          
        case 'audio_data':
          // Convert base64 data to buffer
          const audioBuffer = Buffer.from(data.data, 'base64');
          totalBytes += audioBuffer.length;
          receivedChunks++;
          
          // Log progress periodically (every 100 chunks)
          if (receivedChunks % 100 === 0) {
            logger.info(`Received ${receivedChunks} audio chunks (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
          }
          
          // Save to file if enabled
          if (SAVE_AUDIO && fileStream) {
            fileStream.write(audioBuffer);
          }
          break;
          
        case 'heartbeat':
          // Respond to heartbeat
          ws.send(JSON.stringify({
            type: 'heartbeat_ack',
            timestamp: Date.now()
          }));
          break;
          
        case 'end':
          logger.info(`Received end message: ${JSON.stringify(data)}`);
          // Close file stream if open
          if (fileStream) {
            fileStream.end();
          }
          
          // Log session summary
          const sessionDuration = (new Date() - sessionStartTime) / 1000;
          logger.info(`Session summary:`);
          logger.info(`- Duration: ${sessionDuration.toFixed(2)} seconds`);
          logger.info(`- Chunks received: ${receivedChunks}`);
          logger.info(`- Total data: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
          break;
          
        default:
          logger.info(`Received unknown message type: ${data.type}`);
      }
    } catch (error) {
      logger.error(`Error processing message: ${error.message}`);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    logger.info(`Connection from ${clientIp} closed`);
    
    // Close file stream if open
    if (fileStream) {
      fileStream.end();
    }
    
    // Log session summary
    const sessionDuration = (new Date() - sessionStartTime) / 1000;
    logger.info(`Session summary:`);
    logger.info(`- Duration: ${sessionDuration.toFixed(2)} seconds`);
    logger.info(`- Chunks received: ${receivedChunks}`);
    logger.info(`- Total data: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    logger.error(`WebSocket error: ${error.message}`);
  });
});

// Handle server errors
wss.on('error', (error) => {
  logger.error(`Server error: ${error.message}`);
});

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  wss.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

logger.info('Test WebSocket server is running. Press Ctrl+C to stop.'); 