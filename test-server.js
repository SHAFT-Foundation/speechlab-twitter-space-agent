#!/usr/bin/env node

/**
 * Simple WebSocket server for testing audio streaming
 * This server receives audio chunks from the Twitter Space capture tool
 * and saves them to a file. It handles S16LE format audio at 16000Hz mono.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { Command } = require('commander');
const { spawn } = require('child_process');

// Parse command line arguments
const program = new Command();
program
  .option('-p, --port <port>', 'WebSocket server port', '8080')
  .option('-d, --debug', 'Enable debug logging', false)
  .option('-o, --output-dir <dir>', 'Output directory for received audio', './received-audio')
  .option('-f, --format <format>', 'Output format (raw, wav)', 'wav')
  .parse(process.argv);

const options = program.opts();

// Configure logger
const logger = winston.createLogger({
  level: options.debug ? 'debug' : 'info',
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
    new winston.transports.File({ 
      filename: `test-server-${options.port}.log` 
    })
  ]
});

// Configuration
const PORT = parseInt(options.port, 10);
const SAVE_AUDIO = true;
const OUTPUT_DIR = path.resolve(options.outputDir);
const OUTPUT_FORMAT = options.format.toLowerCase();

// Ensure output directory exists
if (SAVE_AUDIO && !fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

logger.info(`WebSocket server started on port ${PORT}`);
logger.info(`Saving audio to: ${OUTPUT_DIR}`);
logger.info(`Output format: ${OUTPUT_FORMAT}`);
logger.info(`Waiting for connections...`);

// Handle connections
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  logger.info(`New connection from ${clientIp}`);
  
  // Create a file stream for saving audio if enabled
  let rawFileStream = null;
  let wavFileStream = null;
  let audioFormat = 'S16LE';
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let receivedChunks = 0;
  let totalBytes = 0;
  let sessionStartTime = new Date();
  let sessionId = Date.now().toString();
  let rawFilePath = null;
  let wavFilePath = null;
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      // Check if the message is a JSON string or binary data
      if (message instanceof Buffer) {
        // This is binary audio data
        totalBytes += message.length;
        receivedChunks++;
        
        // Log progress periodically (every 100 chunks)
        if (receivedChunks % 100 === 0) {
          logger.info(`Received ${receivedChunks} audio chunks (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
        
        // Save to file if enabled
        if (SAVE_AUDIO && rawFileStream) {
          rawFileStream.write(message);
        }
        
        return;
      }
      
      // Parse the JSON message
      const data = JSON.parse(message);
      
      // Handle different message types
      switch (data.type) {
        case 'metadata':
          logger.info(`Received metadata: ${JSON.stringify(data)}`);
          
          // Update audio format information
          audioFormat = data.encoding || 'S16LE';
          sampleRate = data.sampleRate || 16000;
          channels = data.channels || 1;
          bitsPerSample = data.bitsPerSample || 16;
          
          // Create output files if saving is enabled
          if (SAVE_AUDIO) {
            // Create raw file for S16LE data
            rawFilePath = path.join(OUTPUT_DIR, `twitter-space-port${PORT}-${sessionId}.raw`);
            logger.info(`Saving raw audio to: ${rawFilePath}`);
            rawFileStream = fs.createWriteStream(rawFilePath, { encoding: 'binary' });
            
            // Create WAV file if requested
            if (OUTPUT_FORMAT === 'wav') {
              wavFilePath = path.join(OUTPUT_DIR, `twitter-space-port${PORT}-${sessionId}.wav`);
              logger.info(`Will convert to WAV at: ${wavFilePath}`);
            }
          }
          
          // Send acknowledgement
          ws.send(JSON.stringify({
            type: 'metadata_ack',
            status: 'ok',
            sessionId: sessionId,
            port: PORT,
            format: {
              encoding: audioFormat,
              sampleRate: sampleRate,
              channels: channels,
              bitsPerSample: bitsPerSample
            }
          }));
          break;
          
        case 'audio_data':
          // Handle audio data in JSON format (base64 encoded)
          if (data.data) {
            // Convert base64 data to buffer
            const audioBuffer = Buffer.from(data.data, 'base64');
            totalBytes += audioBuffer.length;
            receivedChunks++;
            
            // Log progress periodically (every 100 chunks)
            if (receivedChunks % 100 === 0) {
              logger.info(`Received ${receivedChunks} audio chunks (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
            }
            
            // Save to file if enabled
            if (SAVE_AUDIO && rawFileStream) {
              rawFileStream.write(audioBuffer);
            }
          }
          break;
          
        case 'heartbeat':
          // Respond to heartbeat
          ws.send(JSON.stringify({
            type: 'heartbeat_ack',
            timestamp: Date.now(),
            port: PORT
          }));
          break;
          
        case 'end':
          logger.info(`Received end message: ${JSON.stringify(data)}`);
          // Close file stream if open
          if (rawFileStream) {
            rawFileStream.end(() => {
              logger.info(`Raw audio file saved: ${rawFilePath}`);
              
              // Convert to WAV if needed
              if (OUTPUT_FORMAT === 'wav' && rawFilePath && wavFilePath) {
                convertRawToWav(rawFilePath, wavFilePath, sampleRate, channels, bitsPerSample)
                  .then(() => {
                    logger.info(`Converted to WAV: ${wavFilePath}`);
                  })
                  .catch(error => {
                    logger.error(`Failed to convert to WAV: ${error.message}`);
                  });
              }
            });
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
    if (rawFileStream) {
      rawFileStream.end(() => {
        logger.info(`Raw audio file saved: ${rawFilePath}`);
        
        // Convert to WAV if needed
        if (OUTPUT_FORMAT === 'wav' && rawFilePath && wavFilePath) {
          convertRawToWav(rawFilePath, wavFilePath, sampleRate, channels, bitsPerSample)
            .then(() => {
              logger.info(`Converted to WAV: ${wavFilePath}`);
            })
            .catch(error => {
              logger.error(`Failed to convert to WAV: ${error.message}`);
            });
        }
      });
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

/**
 * Convert raw S16LE audio to WAV format
 * @param {string} rawFilePath - Path to raw audio file
 * @param {string} wavFilePath - Path to output WAV file
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} channels - Number of channels
 * @param {number} bitsPerSample - Bits per sample
 * @returns {Promise<void>}
 */
function convertRawToWav(rawFilePath, wavFilePath, sampleRate, channels, bitsPerSample) {
  return new Promise((resolve, reject) => {
    logger.info(`Converting raw audio to WAV...`);
    logger.info(`Sample rate: ${sampleRate}Hz, Channels: ${channels}, Bits: ${bitsPerSample}`);
    
    // Use SoX to convert raw audio to WAV
    const soxProcess = spawn('sox', [
      '-t', 'raw',
      '-r', sampleRate.toString(),
      '-b', bitsPerSample.toString(),
      '-c', channels.toString(),
      '-e', 'signed-integer',
      '-L', // Little-endian
      rawFilePath,
      wavFilePath
    ]);
    
    soxProcess.stdout.on('data', (data) => {
      logger.debug(`SoX output: ${data.toString()}`);
    });
    
    soxProcess.stderr.on('data', (data) => {
      logger.debug(`SoX error: ${data.toString()}`);
    });
    
    soxProcess.on('close', (code) => {
      if (code === 0) {
        logger.info(`Successfully converted raw audio to WAV: ${wavFilePath}`);
        resolve();
      } else {
        const error = new Error(`SoX process exited with code ${code}`);
        logger.error(error.message);
        reject(error);
      }
    });
    
    soxProcess.on('error', (error) => {
      logger.error(`SoX process error: ${error.message}`);
      reject(error);
    });
  });
}

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

logger.info(`Test WebSocket server is running on port ${PORT}. Press Ctrl+C to stop.`); 