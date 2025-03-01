const logger = require('../utils/logger');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AudioRecorder = require('node-audiorecorder');
const WebSocket = require('ws');

/**
 * Setup audio capture from the browser
 * @param {Object} page - Playwright page object
 * @returns {Promise<Object>} Audio capture configuration
 */
async function setupAudioCapture(page) {
  logger.info('Setting up audio capture...');
  
  try {
    // Check if page is still open
    if (!page || page.isClosed()) {
      throw new Error('Page is closed or not available');
    }
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, '../../recordings');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate output file path with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilePath = path.join(outputDir, `twitter-space-${timestamp}.wav`);
    logger.info(`Output file path: ${outputFilePath}`);
    
    // Create audio capture configuration
    const audioCapture = {
      page,
      outputFilePath,
      isRecording: false,
      audioRecorder: null,
      fileStream: null,
      dataCollectionInterval: null,
      audioBuffer: [],
      wsConnection: null,
      audioContext: null,
      scriptProcessor: null,
      mediaStreamSource: null,
      gainNode: null
    };
    
    // Check if we're in headless mode
    const isHeadless = process.env.BROWSER_HEADLESS === 'true';
    logger.info(`Browser headless mode: ${isHeadless}`);
    
    // Setup system audio recorder if not in headless mode
    if (!isHeadless) {
      try {
        logger.info('Setting up system audio recorder...');
        
        // Configure audio recorder for system audio (not microphone)
        const recorder = new AudioRecorder({
          program: 'sox',
          device: null, // Use system default audio device
          bits: 16,
          channels: 1,
          encoding: 'signed-integer',
          rate: 16000,
          type: 'wav',
          silence: 0, // No silence detection
          thresholdStart: 0, // Start immediately
          thresholdStop: 0, // Never stop automatically
          keepSilence: true, // Keep silence in recording
          audioType: 'system', // Capture system audio, not microphone
        }, logger);
        
        logger.info('System audio recorder configured successfully');
        logger.debug(`Recorder settings: ${JSON.stringify({
          bits: 16,
          channels: 1,
          rate: 16000,
          type: 'wav',
          audioType: 'system'
        })}`);
        
        audioCapture.audioRecorder = recorder;
        
        // Log available devices
        logger.debug('Attempting to list available audio devices...');
        try {
          const { exec } = require('child_process');
          exec('sox -help', (error, stdout, stderr) => {
            if (error) {
              logger.debug(`Error getting sox help: ${error.message}`);
              return;
            }
            logger.debug(`Sox help output: ${stdout}`);
          });
          
          // Try to list audio devices
          exec('sox -d', (error, stdout, stderr) => {
            if (error) {
              logger.debug(`Error listing audio devices: ${error.message}`);
              return;
            }
            logger.debug(`Audio devices: ${stderr}`);
          });
        } catch (err) {
          logger.debug(`Error listing audio devices: ${err.message}`);
        }
      } catch (error) {
        logger.error(`Failed to setup system audio recorder: ${error.message}`);
        logger.warn('Falling back to browser-based audio capture');
      }
    }
    
    // Setup browser-based audio capture as fallback or for headless mode
    logger.info('Setting up browser-based audio capture...');
    
    try {
      // Find all audio and video elements on the page
      const mediaElementsCount = await page.evaluate(() => {
        // Find all audio and video elements
        const mediaElements = document.querySelectorAll('audio, video');
        console.log(`Found ${mediaElements.length} media elements on the page`);
        
        // Log details about each media element
        Array.from(mediaElements).forEach((element, index) => {
          console.log(`Media element ${index}:`, {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            src: element.src,
            currentSrc: element.currentSrc,
            paused: element.paused,
            muted: element.muted,
            volume: element.volume,
            readyState: element.readyState,
            networkState: element.networkState
          });
          
          // Ensure it's unmuted and at max volume
          try {
            element.muted = false;
            element.volume = 1.0;
            console.log(`Set element ${index} to unmuted and max volume`);
          } catch (err) {
            console.error(`Error configuring media element ${index}:`, err);
          }
        });
        
        return mediaElements.length;
      });
      
      logger.info(`Found ${mediaElementsCount} media elements on the page`);
      
      // Setup audio context and connect to media elements
      await page.evaluate(() => {
        try {
          // Create audio context if it doesn't exist
          if (!window.twitterSpaceAudioContext) {
            console.log('Creating new AudioContext');
            window.twitterSpaceAudioContext = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: 16000
            });
            console.log(`AudioContext created with sample rate: ${window.twitterSpaceAudioContext.sampleRate}Hz`);
          }
          
          // Create gain node to combine all audio sources
          if (!window.twitterSpaceGainNode) {
            console.log('Creating gain node');
            window.twitterSpaceGainNode = window.twitterSpaceAudioContext.createGain();
            window.twitterSpaceGainNode.gain.value = 1.0;
            
            // Connect gain node to destination (speakers)
            window.twitterSpaceGainNode.connect(window.twitterSpaceAudioContext.destination);
            console.log('Gain node connected to audio context destination');
          }
          
          // Create script processor for capturing audio data
          if (!window.twitterSpaceScriptProcessor) {
            console.log('Creating script processor node');
            window.twitterSpaceScriptProcessor = window.twitterSpaceAudioContext.createScriptProcessor(4096, 1, 1);
            
            // Connect script processor to gain node
            window.twitterSpaceScriptProcessor.connect(window.twitterSpaceGainNode);
            console.log('Script processor connected to gain node');
            
            // Create buffer to store audio data
            window.twitterSpaceAudioBuffer = [];
            
            // Setup audio processing callback
            window.twitterSpaceScriptProcessor.onaudioprocess = (e) => {
              const inputBuffer = e.inputBuffer.getChannelData(0);
              
              // Calculate audio level for logging
              let sum = 0;
              for (let i = 0; i < inputBuffer.length; i++) {
                sum += Math.abs(inputBuffer[i]);
              }
              const average = sum / inputBuffer.length;
              
              // Log audio level periodically (every ~1 second)
              if (Math.random() < 0.01) {
                console.log(`Audio level: ${average.toFixed(6)}`);
              }
              
              // Store audio data
              window.twitterSpaceAudioBuffer.push(new Float32Array(inputBuffer));
              
              // Keep buffer size reasonable
              if (window.twitterSpaceAudioBuffer.length > 100) {
                window.twitterSpaceAudioBuffer.shift();
              }
            };
          }
          
          // Connect all media elements to the audio context
          const mediaElements = document.querySelectorAll('audio, video');
          console.log(`Connecting ${mediaElements.length} media elements to audio context`);
          
          Array.from(mediaElements).forEach((element, index) => {
            try {
              // Skip if already connected
              if (element.twitterSpaceConnected) {
                console.log(`Media element ${index} already connected`);
                return;
              }
              
              // Create media element source
              const source = window.twitterSpaceAudioContext.createMediaElementSource(element);
              console.log(`Created media element source for element ${index}`);
              
              // Connect source to gain node and script processor
              source.connect(window.twitterSpaceGainNode);
              source.connect(window.twitterSpaceScriptProcessor);
              console.log(`Connected media element ${index} to gain node and script processor`);
              
              // Mark as connected
              element.twitterSpaceConnected = true;
              
              // Ensure it's unmuted and at max volume
              element.muted = false;
              element.volume = 1.0;
              
              // Try to play if paused
              if (element.paused && element.readyState >= 2) {
                element.play().catch(e => console.log(`Could not play element ${index}: ${e.message}`));
              }
              
              console.log(`Media element ${index} setup complete`);
            } catch (err) {
              console.error(`Error connecting media element ${index}:`, err);
            }
          });
          
          // Setup methods for starting and stopping recording
          window.startAudioCapture = () => {
            console.log('Starting browser audio capture');
            window.twitterSpaceIsRecording = true;
          };
          
          window.stopAudioCapture = () => {
            console.log('Stopping browser audio capture');
            window.twitterSpaceIsRecording = false;
          };
          
          // Setup method for retrieving audio data
          window.getAudioData = () => {
            if (!window.twitterSpaceAudioBuffer || window.twitterSpaceAudioBuffer.length === 0) {
              return null;
            }
            
            // Get all buffered data
            const buffers = window.twitterSpaceAudioBuffer;
            
            // Clear buffer
            window.twitterSpaceAudioBuffer = [];
            
            return buffers;
          };
          
          console.log('Browser-based audio capture setup complete');
          return true;
        } catch (error) {
          console.error('Error setting up browser-based audio capture:', error);
          return false;
        }
      });
      
      logger.info('Browser-based audio capture setup complete');
    } catch (error) {
      logger.error(`Failed to setup browser-based audio capture: ${error.message}`);
    }
    
    return audioCapture;
  } catch (error) {
    logger.error(`Failed to setup audio capture: ${error.message}`);
    throw error;
  }
}

/**
 * Connect to a WebSocket server for sending audio data
 * @param {string} websocketUrl - WebSocket server URL
 * @returns {Promise<WebSocket>} WebSocket connection
 */
async function connectToWebSocket(websocketUrl) {
  logger.info(`Connecting to WebSocket server: ${websocketUrl}`);
  
  try {
    // Validate WebSocket URL
    if (!websocketUrl || !websocketUrl.startsWith('ws')) {
      throw new Error(`Invalid WebSocket URL: ${websocketUrl}`);
    }
    
    // Create a new WebSocket connection
    const ws = new WebSocket(websocketUrl);
    
    // Set up connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== 1) { // Not OPEN
        logger.error('WebSocket connection timeout');
        ws.close(1006, 'Connection timeout');
      }
    }, 10000); // 10 seconds timeout
    
    // Wait for the connection to open
    await new Promise((resolve, reject) => {
      // Connection opened
      ws.on('open', () => {
        logger.info('WebSocket connection established');
        clearTimeout(connectionTimeout);
        resolve();
      });
      
      // Connection error
      ws.on('error', (error) => {
        logger.error(`WebSocket connection error: ${error.message}`);
        clearTimeout(connectionTimeout);
        reject(error);
      });
    });
    
    // Set up event handlers for the connection
    ws.on('message', (data) => {
      try {
        // Try to parse as JSON
        const message = JSON.parse(data);
        logger.debug(`Received message from WebSocket server: ${JSON.stringify(message)}`);
        
        // Handle different message types
        if (message.type === 'heartbeat') {
          // Respond to heartbeat
          ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: new Date().toISOString() }));
        }
      } catch (error) {
        // Not JSON, log as binary data
        logger.debug(`Received binary data from WebSocket server: ${data.length} bytes`);
      }
    });
    
    ws.on('close', (code, reason) => {
      logger.info(`WebSocket connection closed: ${code} - ${reason}`);
    });
    
    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    });
    
    // Set up heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === 1) { // OPEN
        logger.debug('Sending heartbeat to WebSocket server');
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }));
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // Send heartbeat every 30 seconds
    
    // Store the heartbeat interval for cleanup
    ws.heartbeatInterval = heartbeatInterval;
    
    // Override close method to clean up resources
    const originalClose = ws.close;
    ws.close = function(code, reason) {
      clearInterval(this.heartbeatInterval);
      return originalClose.call(this, code, reason);
    };
    
    return ws;
  } catch (error) {
    logger.error(`Failed to connect to WebSocket server: ${error.message}`);
    
    // Try to reconnect with exponential backoff
    logger.info('Will attempt to reconnect...');
    return null;
  }
}

/**
 * Start recording audio from the Twitter Space
 * @param {Object} audioCapture - Audio capture configuration
 * @param {string} websocketUrl - WebSocket URL to send audio data to (optional)
 * @returns {Promise<boolean>} Success status
 */
async function startRecording(audioCapture, websocketUrl = null) {
  logger.info('Starting audio recording...');
  
  try {
    // Check if audio capture is set up
    if (!audioCapture) {
      logger.error('Audio capture not set up');
      return false;
    }
    
    // Set recording flag
    audioCapture.isRecording = true;
    
    // Connect to WebSocket if URL is provided
    if (websocketUrl) {
      logger.info(`Connecting to WebSocket: ${websocketUrl}`);
      audioCapture.wsConnection = await connectToWebSocket(websocketUrl);
      
      // Send initial metadata to WebSocket
      if (audioCapture.wsConnection) {
        const metadata = {
          type: 'metadata',
          format: 'S16LE',
          sampleRate: 16000,
          channels: 1,
          timestamp: new Date().toISOString()
        };
        
        logger.info(`Sending metadata to WebSocket: ${JSON.stringify(metadata)}`);
        audioCapture.wsConnection.send(JSON.stringify(metadata));
      }
    }
    
    // Create file stream for saving audio
    logger.info(`Creating file stream for output: ${audioCapture.outputFilePath}`);
    audioCapture.fileStream = fs.createWriteStream(audioCapture.outputFilePath, { encoding: 'binary' });
    
    // Start the recorder if available (system audio recording)
    if (audioCapture.audioRecorder) {
      logger.info(`Starting system audio recorder, saving to: ${audioCapture.outputFilePath}`);
      
      // Start the recorder and pipe to file
      const stream = audioCapture.audioRecorder.start().stream();
      stream.pipe(audioCapture.fileStream);
      
      // Set up data event handler for the recorder
      stream.on('data', (chunk) => {
        // Log audio data size periodically
        if (Math.random() < 0.01) { // Log roughly 1% of the time
          logger.debug(`Received audio chunk: ${chunk.length} bytes`);
        }
        
        // Send to WebSocket if connected
        if (audioCapture.wsConnection && audioCapture.wsConnection.readyState === 1) {
          try {
            audioCapture.wsConnection.send(chunk);
          } catch (error) {
            logger.error(`Error sending audio data to WebSocket: ${error.message}`);
          }
        }
      });
      
      // Set up error handler
      stream.on('error', (error) => {
        logger.error(`Recorder error: ${error.message}`);
      });
      
      // Set up close handler
      stream.on('close', () => {
        logger.info('Recorder stream closed');
      });
      
      logger.info('System audio recorder started successfully');
    } else {
      // Fall back to browser-based recording
      logger.info('Starting browser-based audio recording');
      
      // Start the browser-based recording
      const startResult = await audioCapture.page.evaluate(() => {
        if (window.startAudioCapture && typeof window.startAudioCapture === 'function') {
          window.startAudioCapture();
          return true;
        }
        return false;
      });
      
      if (startResult) {
        logger.info('Browser-based audio recording started successfully');
        
        // Set up interval to collect and send audio data from the browser
        audioCapture.dataCollectionInterval = setInterval(async () => {
          try {
            if (!audioCapture.isRecording) {
              clearInterval(audioCapture.dataCollectionInterval);
              return;
            }
            
            // Get audio data from the browser
            const audioData = await audioCapture.page.evaluate(() => {
              if (window.getAudioData && typeof window.getAudioData === 'function') {
                return window.getAudioData();
              }
              return null;
            });
            
            if (audioData && Array.isArray(audioData) && audioData.length > 0) {
              logger.debug(`Received ${audioData.length} audio buffers from browser`);
              
              // Process each buffer
              for (const buffer of audioData) {
                // Convert Float32Array to Int16Array (S16LE format)
                const int16Buffer = new Int16Array(buffer.length);
                
                for (let i = 0; i < buffer.length; i++) {
                  // Clamp values to [-1, 1] and scale to [-32768, 32767]
                  const sample = Math.max(-1, Math.min(1, buffer[i]));
                  int16Buffer[i] = Math.floor(sample * 32767);
                }
                
                // Convert to Buffer
                const audioBuffer = Buffer.from(int16Buffer.buffer);
                
                // Write to file
                audioCapture.fileStream.write(audioBuffer);
                
                // Send to WebSocket if connected
                if (audioCapture.wsConnection && audioCapture.wsConnection.readyState === 1) {
                  try {
                    audioCapture.wsConnection.send(audioBuffer);
                  } catch (error) {
                    logger.error(`Error sending audio data to WebSocket: ${error.message}`);
                  }
                }
              }
              
              // Log audio level periodically
              if (Math.random() < 0.1) {
                const lastBuffer = audioData[audioData.length - 1];
                let sum = 0;
                for (let i = 0; i < lastBuffer.length; i++) {
                  sum += Math.abs(lastBuffer[i]);
                }
                const average = sum / lastBuffer.length;
                logger.debug(`Audio level: ${average.toFixed(6)}`);
              }
            }
          } catch (error) {
            logger.error(`Error collecting audio data: ${error.message}`);
          }
        }, 100); // Collect data every 100ms
      } else {
        logger.error('Failed to start browser-based audio recording');
        return false;
      }
    }
    
    logger.info('Audio recording started successfully');
    return true;
  } catch (error) {
    logger.error(`Failed to start audio recording: ${error.message}`);
    return false;
  }
}

/**
 * Stop recording audio
 * @param {Object} audioCapture - Audio capture configuration
 * @returns {Promise<boolean>} Success status
 */
async function stopRecording(audioCapture) {
  logger.info('Stopping audio recording...');
  
  try {
    // Check if audio capture is set up
    if (!audioCapture) {
      logger.warn('No audio capture to stop');
      return false;
    }
    
    // Set recording flag to false
    audioCapture.isRecording = false;
    
    // Stop the system audio recorder if available
    if (audioCapture.audioRecorder) {
      logger.info('Stopping system audio recorder...');
      audioCapture.audioRecorder.stop();
      logger.info('System audio recorder stopped');
    }
    
    // Clear data collection interval if set
    if (audioCapture.dataCollectionInterval) {
      logger.info('Clearing data collection interval...');
      clearInterval(audioCapture.dataCollectionInterval);
      audioCapture.dataCollectionInterval = null;
    }
    
    // Close file stream if open
    if (audioCapture.fileStream) {
      logger.info('Closing file stream...');
      audioCapture.fileStream.end();
      audioCapture.fileStream = null;
    }
    
    // Stop browser-based recording if active
    if (audioCapture.page && !audioCapture.page.isClosed()) {
      logger.info('Stopping browser-based audio recording...');
      await audioCapture.page.evaluate(() => {
        if (window.stopAudioCapture && typeof window.stopAudioCapture === 'function') {
          window.stopAudioCapture();
          return true;
        }
        return false;
      });
    }
    
    // Close WebSocket connection if open
    if (audioCapture.wsConnection) {
      logger.info('Closing WebSocket connection...');
      if (audioCapture.wsConnection.readyState === 1) { // OPEN
        // Send end message
        try {
          const endMessage = {
            type: 'end',
            timestamp: new Date().toISOString()
          };
          audioCapture.wsConnection.send(JSON.stringify(endMessage));
          
          // Close the connection
          audioCapture.wsConnection.close(1000, 'Recording stopped');
        } catch (error) {
          logger.error(`Error closing WebSocket connection: ${error.message}`);
        }
      }
      audioCapture.wsConnection = null;
    }
    
    logger.info('Audio recording stopped successfully');
    logger.info(`Recording saved to: ${audioCapture.outputFilePath}`);
    return true;
  } catch (error) {
    logger.error(`Failed to stop audio recording: ${error.message}`);
    return false;
  }
}

/**
 * Convert audio to S16LE format at 16000Hz mono
 * @param {string} inputFile - Input audio file path
 * @param {string} outputFile - Output audio file path
 * @returns {Promise<string>} Path to the converted file
 */
async function convertAudioToS16LE(inputFile, outputFile) {
  logger.info(`Converting audio to S16LE format at 16000Hz mono...`);
  logger.info(`Input: ${inputFile}`);
  logger.info(`Output: ${outputFile}`);
  
  return new Promise((resolve, reject) => {
    // Use SoX to convert the audio
    const soxProcess = spawn('sox', [
      inputFile,
      '-t', 'raw',
      '-r', '16000',
      '-b', '16',
      '-c', '1',
      '-e', 'signed-integer',
      '-L', // Little-endian
      outputFile
    ]);
    
    soxProcess.stdout.on('data', (data) => {
      logger.debug(`SoX output: ${data.toString()}`);
    });
    
    soxProcess.stderr.on('data', (data) => {
      logger.debug(`SoX error: ${data.toString()}`);
    });
    
    soxProcess.on('close', (code) => {
      if (code === 0) {
        logger.info(`Audio conversion successful: ${outputFile}`);
        resolve(outputFile);
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

module.exports = {
  setupAudioCapture,
  startRecording,
  stopRecording,
  connectToWebSocket,
  convertAudioToS16LE
}; 