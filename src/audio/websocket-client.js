const WebSocket = require('ws');
const logger = require('../utils/logger');

// WebSocket connection state
let wsConnection = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;

/**
 * Connect to WebSocket endpoint for streaming audio
 * @param {string} endpoint - WebSocket endpoint URL
 * @returns {WebSocket} WebSocket connection
 */
async function connectToWebSocket(endpoint) {
  logger.info(`Connecting to WebSocket: ${endpoint}`);
  
  if (!endpoint) {
    throw new Error('WebSocket endpoint URL is required');
  }
  
  return new Promise((resolve, reject) => {
    try {
      connectionRetries = 0;
      
      // Create WebSocket connection
      wsConnection = new WebSocket(endpoint);
      
      // Connection opened
      wsConnection.on('open', () => {
        logger.info('WebSocket connection established successfully');
        
        // Send initial metadata message
        const metadata = {
          type: 'metadata',
          source: 'twitter-space-audio-capture',
          timestamp: new Date().toISOString(),
          format: process.env.AUDIO_FORMAT || 'wav',
          sampleRate: process.env.AUDIO_QUALITY === 'low' ? 22050 : 
                      process.env.AUDIO_QUALITY === 'high' ? 48000 : 44100,
          channels: 2
        };
        
        wsConnection.send(JSON.stringify(metadata));
        logger.debug('Sent metadata to WebSocket server');
        
        resolve(wsConnection);
      });
      
      // Connection error
      wsConnection.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          logger.info(`Retrying connection (${connectionRetries}/${MAX_RETRIES})...`);
          setTimeout(() => {
            connectToWebSocket(endpoint)
              .then(resolve)
              .catch(reject);
          }, 2000 * connectionRetries);
        } else {
          reject(new Error('Max WebSocket connection retries exceeded'));
        }
      });
      
      // Connection closed
      wsConnection.on('close', (code, reason) => {
        logger.info(`WebSocket connection closed: ${code} - ${reason}`);
        
        // Attempt reconnection if unexpected closure
        if (code !== 1000 && connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          logger.info(`Attempting to reconnect (${connectionRetries}/${MAX_RETRIES})...`);
          setTimeout(() => {
            connectToWebSocket(endpoint)
              .then(resolve)
              .catch(reject);
          }, 2000 * connectionRetries);
        }
      });
      
      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.send(JSON.stringify({ type: 'heartbeat' }));
          logger.debug('Sent heartbeat to WebSocket server');
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000); // 30 seconds
      
    } catch (error) {
      logger.error(`Failed to connect to WebSocket: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * Send audio chunk to WebSocket server
 * @param {WebSocket} ws - WebSocket connection
 * @param {Buffer} chunk - Audio data chunk
 * @returns {Promise<void>}
 */
async function sendAudioChunk(ws, chunk) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.debug('WebSocket not open, cannot send audio chunk');
    return false;
  }
  
  try {
    // Create message with audio data
    const message = {
      type: 'audio_data',
      timestamp: Date.now(),
      format: process.env.AUDIO_FORMAT || 'wav',
      // Convert buffer to base64 for sending as JSON
      data: chunk.toString('base64')
    };
    
    // Send as JSON
    ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    logger.error(`Failed to send audio chunk: ${error.message}`);
    return false;
  }
}

/**
 * Close WebSocket connection
 * @returns {Promise<void>}
 */
async function closeWebSocketConnection() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    logger.info('Closing WebSocket connection...');
    
    // Send end message
    wsConnection.send(JSON.stringify({
      type: 'end',
      timestamp: Date.now()
    }));
    
    // Close connection
    wsConnection.close(1000, 'Normal closure');
    wsConnection = null;
    
    logger.info('WebSocket connection closed successfully');
  }
}

module.exports = {
  connectToWebSocket,
  sendAudioChunk,
  closeWebSocketConnection
}; 