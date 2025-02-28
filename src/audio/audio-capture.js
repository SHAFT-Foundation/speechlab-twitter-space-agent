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
    
    // Wait for audio to be available
    logger.info('Waiting for audio to be available...');
    try {
      await page.waitForTimeout(5000);
    } catch (error) {
      logger.error(`Error waiting for audio: ${error.message}`);
      throw new Error(`Failed to wait for audio: ${error.message}`);
    }
    
    // Check if page is still open after waiting
    if (!page || page.isClosed()) {
      throw new Error('Page was closed while waiting for audio');
    }
    
    // Try to find media elements with multiple attempts
    let mediaElementsFound = false;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!mediaElementsFound && attempts < maxAttempts) {
      attempts++;
      logger.info(`Attempt ${attempts}/${maxAttempts} to find media elements...`);
      
      // Check for media elements
      const hasMediaElements = await page.evaluate(() => {
        const audioElements = document.querySelectorAll('audio');
        const videoElements = document.querySelectorAll('video');
        return audioElements.length > 0 || videoElements.length > 0;
      }).catch(error => {
        logger.error(`Error checking for media elements: ${error.message}`);
        return false;
      });
      
      if (hasMediaElements) {
        logger.info('Media elements found on the page');
        mediaElementsFound = true;
      } else {
        logger.warn(`No media elements found on attempt ${attempts}/${maxAttempts}`);
        
        if (attempts < maxAttempts) {
          // Try to interact with the page to trigger media elements
          await page.evaluate(() => {
            // Click on various elements that might trigger audio
            const possibleTriggers = [
              document.querySelector('[data-testid="audioSpaceBarPlayButton"]'),
              document.querySelector('[data-testid="audioSpaceControls"]'),
              document.querySelector('[role="button"]:has-text("Listen")')
            ];
            
            possibleTriggers.forEach(element => {
              if (element) element.click();
            });
          }).catch(error => {
            logger.warn(`Error interacting with page: ${error.message}`);
          });
          
          // Take a screenshot to debug
          const screenshotPath = path.join(__dirname, '../../logs', `media-search-attempt-${attempts}-${Date.now()}.png`);
          await page.screenshot({ path: screenshotPath }).catch(e => logger.error(`Failed to take screenshot: ${e.message}`));
          logger.info(`Screenshot saved to: ${screenshotPath}`);
          
          // Wait before next attempt
          logger.info(`Waiting 5 seconds before next attempt...`);
          await page.waitForTimeout(5000);
        }
      }
    }
    
    if (!mediaElementsFound) {
      logger.warn(`Could not find media elements after ${maxAttempts} attempts. Will try to continue anyway.`);
    }
    
    // Check if we can access the audio context
    const audioContextAvailable = await page.evaluate(() => {
      return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
    }).catch(error => {
      logger.error(`Error checking audio context: ${error.message}`);
      return false;
    });
    
    if (!audioContextAvailable) {
      throw new Error('AudioContext not available in the browser');
    }
    
    // Create audio capture in the page context
    logger.info('Creating audio capture in page context...');
    const audioCaptureObj = await page.evaluate(() => {
      // Create audio context
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      
      // Find all audio and video elements
      const audioElements = Array.from(document.querySelectorAll('audio'));
      const videoElements = Array.from(document.querySelectorAll('video'));
      
      console.log(`Found ${audioElements.length} audio elements and ${videoElements.length} video elements`);
      
      // Create media element sources
      const sources = [];
      
      // Connect audio elements
      audioElements.forEach((audio, index) => {
        try {
          // Unmute and set volume to max
          audio.muted = false;
          audio.volume = 1.0;
          
          // Create source
          const source = audioContext.createMediaElementSource(audio);
          sources.push(source);
          
          console.log(`Connected audio element ${index}`);
        } catch (error) {
          console.error(`Error connecting audio element ${index}: ${error.message}`);
        }
      });
      
      // Connect video elements (for their audio)
      videoElements.forEach((video, index) => {
        try {
          // Unmute and set volume to max
          video.muted = false;
          video.volume = 1.0;
          
          // Create source
          const source = audioContext.createMediaElementSource(video);
          sources.push(source);
          
          console.log(`Connected video element ${index}`);
        } catch (error) {
          console.error(`Error connecting video element ${index}: ${error.message}`);
        }
      });
      
      // Create a gain node to combine all sources
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0;
      
      // Connect all sources to the gain node
      sources.forEach(source => source.connect(gainNode));
      
      // Connect gain node to destination (speakers)
      gainNode.connect(audioContext.destination);
      
      // Create a script processor for capturing audio data
      // Note: ScriptProcessorNode is deprecated but still widely supported
      const bufferSize = 4096;
      const scriptProcessor = audioContext.createScriptProcessor(
        bufferSize,
        2, // Input channels (stereo)
        2  // Output channels (stereo)
      );
      
      // Connect gain node to script processor
      gainNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      // Buffer to store audio data
      let audioBuffer = [];
      
      // Handle audio processing
      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Store the audio data
        const buffer = new Float32Array(inputData);
        audioBuffer.push(buffer);
        
        // Limit buffer size to prevent memory issues
        if (audioBuffer.length > 100) {
          audioBuffer.shift();
        }
      };
      
      // Return the audio capture interface
      return {
        isCapturing: true,
        connectedSources: sources.length,
        sampleRate: audioContext.sampleRate,
        
        // Get audio data
        getAudioData: () => {
          if (audioBuffer.length === 0) {
            return null;
          }
          
          // Concatenate all buffers
          const totalLength = audioBuffer.reduce((acc, buf) => acc + buf.length, 0);
          const result = new Float32Array(totalLength);
          
          let offset = 0;
          audioBuffer.forEach(buffer => {
            result.set(buffer, offset);
            offset += buffer.length;
          });
          
          // Clear the buffer after reading
          audioBuffer = [];
          
          return result;
        },
        
        // Start recording
        startRecording: () => {
          console.log('Starting browser recording...');
          audioBuffer = [];
        },
        
        // Stop recording
        stopRecording: () => {
          console.log('Stopping browser recording...');
          audioBuffer = [];
        }
      };
    }).catch(error => {
      logger.error(`Error creating audio capture: ${error.message}`);
      throw new Error(`Failed to create audio capture: ${error.message}`);
    });
    
    // Create temporary directory for recordings if it doesn't exist
    const recordingsDir = path.join(__dirname, '../../recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    
    // Create output file path
    const outputFile = path.join(recordingsDir, `twitter-space-${Date.now()}.wav`);
    
    // Initialize recorder with S16LE format, 16000Hz, mono
    const recorder = new AudioRecorder({
      program: 'sox',
      bits: 16,
      channels: 1,
      rate: 16000,
      type: 'wav',
      silence: 0
    });
    
    logger.info(`Audio capture setup complete. Sample rate: 16000Hz, Format: S16LE, Channels: 1`);
    logger.info(`Recording will be saved to: ${outputFile}`);
    
    // Return the complete audio capture object
    return {
      page,
      recorder,
      outputFile,
      isHeadless: process.env.BROWSER_HEADLESS === 'true',
      audioCaptureObj
    };
  } catch (error) {
    logger.error(`Failed to setup audio capture: ${error.message}`);
    throw error;
  }
}

/**
 * Connect to WebSocket endpoint for streaming audio
 * @param {string} websocketEndpoint - WebSocket endpoint URL
 * @param {Object} audioCapture - Audio capture configuration
 * @returns {Promise<Object>} WebSocket connection and utilities
 */
async function connectToWebSocket(websocketEndpoint, audioCapture) {
  logger.info(`Connecting to WebSocket endpoint: ${websocketEndpoint}`);
  
  // Create a more robust WebSocket connection with reconnection logic
  let ws = null;
  let connected = false;
  let reconnectAttempt = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 2000; // 2 seconds
  
  const connectWebSocket = () => {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Attempting WebSocket connection to ${websocketEndpoint} (attempt ${reconnectAttempt + 1}/${maxReconnectAttempts})`);
        
        // Close existing connection if any
        if (ws) {
          try {
            ws.terminate();
          } catch (e) {
            logger.warn(`Error terminating existing WebSocket: ${e.message}`);
          }
        }
        
        // Create new WebSocket connection
        ws = new WebSocket(websocketEndpoint);
        
        // Set up event handlers
        ws.on('open', () => {
          logger.info('WebSocket connection established successfully');
          connected = true;
          
          // Send initial metadata
          try {
            const metadata = {
              type: 'metadata',
              sampleRate: 16000,
              channels: 1,
              bitsPerSample: 16,
              encoding: 'S16LE',
              source: 'twitter-space'
            };
            
            ws.send(JSON.stringify(metadata));
            logger.info('Sent audio metadata to WebSocket server');
          } catch (error) {
            logger.error(`Error sending metadata: ${error.message}`);
          }
          
          resolve(ws);
        });
        
        ws.on('error', (error) => {
          logger.error(`WebSocket error: ${error.message}`);
          if (!connected) {
            reject(error);
          }
        });
        
        ws.on('close', (code, reason) => {
          logger.warn(`WebSocket connection closed: Code ${code}, Reason: ${reason || 'No reason provided'}`);
          connected = false;
          
          // Attempt to reconnect if not manually closed
          if (code !== 1000 && reconnectAttempt < maxReconnectAttempts) {
            reconnectAttempt++;
            logger.info(`Attempting to reconnect (${reconnectAttempt}/${maxReconnectAttempts}) in ${reconnectDelay}ms...`);
            
            setTimeout(() => {
              connectWebSocket()
                .then(newWs => {
                  ws = newWs;
                  logger.info('WebSocket reconnected successfully');
                })
                .catch(error => {
                  logger.error(`Failed to reconnect WebSocket: ${error.message}`);
                });
            }, reconnectDelay);
          }
        });
        
        // Set up heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
              logger.debug('Sent heartbeat to WebSocket server');
            } catch (error) {
              logger.warn(`Error sending heartbeat: ${error.message}`);
            }
          } else if (!connected) {
            clearInterval(heartbeatInterval);
          }
        }, 30000); // Send heartbeat every 30 seconds
        
        // Clean up interval on close
        ws.on('close', () => {
          clearInterval(heartbeatInterval);
        });
        
      } catch (error) {
        logger.error(`Error creating WebSocket connection: ${error.message}`);
        reject(error);
      }
    });
  };
  
  // Initial connection attempt
  try {
    ws = await connectWebSocket();
    
    // Return the WebSocket and a function to send audio data
    return {
      ws,
      sendAudioData: (audioData) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            // Send the raw audio data (already in S16LE format from recorder)
            ws.send(audioData);
            return true;
          } catch (error) {
            logger.error(`Error sending audio data: ${error.message}`);
            return false;
          }
        }
        return false;
      },
      close: () => {
        if (ws) {
          try {
            ws.close(1000, 'Closing connection normally');
            logger.info('WebSocket connection closed normally');
          } catch (error) {
            logger.error(`Error closing WebSocket: ${error.message}`);
          }
        }
      }
    };
  } catch (error) {
    logger.error(`Failed to connect to WebSocket: ${error.message}`);
    throw error;
  }
}

/**
 * Start recording audio from the browser
 * @param {Object} audioCapture - Audio capture configuration
 * @param {Object} wsConnection - WebSocket connection object
 * @returns {Promise<boolean>} True if recording started successfully, false otherwise
 */
async function startRecording(audioCapture, wsConnection) {
  logger.info('Starting audio recording...');
  
  if (!audioCapture) {
    throw new Error('Audio capture not set up');
  }
  
  try {
    // Start the recorder
    if (audioCapture.recorder) {
      logger.info(`Starting recorder, saving to: ${audioCapture.outputFile}`);
      audioCapture.recorder.start().stream();
      
      // Set up data event handler for the recorder
      audioCapture.recorder.stream().on('data', (chunk) => {
        // Save to file (handled automatically by the recorder)
        
        // Send to WebSocket if available
        if (wsConnection && typeof wsConnection.sendAudioData === 'function') {
          const success = wsConnection.sendAudioData(chunk);
          if (!success) {
            logger.warn('Failed to send audio chunk to WebSocket');
          }
        }
      });
      
      // Set up error handler
      audioCapture.recorder.stream().on('error', (error) => {
        logger.error(`Recorder error: ${error.message}`);
      });
      
      // Set up close handler
      audioCapture.recorder.stream().on('close', () => {
        logger.info('Recorder stream closed');
      });
      
      logger.info('Recorder started successfully');
    } else {
      // Fall back to browser-based recording if recorder not available
      logger.info('Using browser-based recording (no local recorder available)');
      
      await audioCapture.page.evaluate(() => {
        if (window.audioCapture && typeof window.audioCapture.startRecording === 'function') {
          window.audioCapture.startRecording();
          return true;
        }
        return false;
      });
      
      // Set up interval to collect and send audio data from the browser
      const dataCollectionInterval = setInterval(async () => {
        try {
          const audioData = await audioCapture.page.evaluate(() => {
            if (window.audioCapture && typeof window.audioCapture.getAudioData === 'function') {
              return window.audioCapture.getAudioData();
            }
            return null;
          });
          
          if (audioData && wsConnection && typeof wsConnection.sendAudioData === 'function') {
            // Convert Float32Array to S16LE format (16-bit signed integers, little-endian)
            // and downsample to 16000Hz if needed
            const float32Array = new Float32Array(audioData);
            
            // Create a buffer for the S16LE data
            const s16leBuffer = Buffer.alloc(float32Array.length * 2); // 2 bytes per sample
            
            // Convert Float32Array to S16LE
            for (let i = 0; i < float32Array.length; i++) {
              // Convert float (-1.0 to 1.0) to int16 (-32768 to 32767)
              const sample = Math.max(-1, Math.min(1, float32Array[i]));
              const int16Sample = Math.floor(sample * 32767);
              
              // Write as little-endian
              s16leBuffer.writeInt16LE(int16Sample, i * 2);
            }
            
            // Send the converted buffer
            const success = wsConnection.sendAudioData(s16leBuffer);
            if (!success) {
              logger.warn('Failed to send browser audio data to WebSocket');
            }
          }
        } catch (error) {
          logger.error(`Error collecting browser audio data: ${error.message}`);
          clearInterval(dataCollectionInterval);
        }
      }, 1000); // Collect data every second
      
      // Store the interval ID for cleanup
      audioCapture.dataCollectionInterval = dataCollectionInterval;
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to start recording: ${error.message}`);
    throw error;
  }
}

/**
 * Stop recording audio
 * @param {Object} audioCapture - Audio capture configuration
 * @param {Object} wsConnection - WebSocket connection object
 * @returns {Promise<boolean>} True if recording stopped successfully, false otherwise
 */
async function stopRecording(audioCapture, wsConnection) {
  logger.info('Stopping audio recording...');
  
  if (!audioCapture) {
    logger.warn('No audio capture to stop');
    return;
  }
  
  try {
    // Stop the recorder if available
    if (audioCapture.recorder) {
      logger.info('Stopping recorder...');
      audioCapture.recorder.stop();
      logger.info('Recorder stopped');
    }
    
    // Clear any data collection interval
    if (audioCapture.dataCollectionInterval) {
      clearInterval(audioCapture.dataCollectionInterval);
      audioCapture.dataCollectionInterval = null;
      logger.info('Data collection interval cleared');
    }
    
    // Stop browser-based recording if active
    if (audioCapture.page && !audioCapture.page.isClosed()) {
      await audioCapture.page.evaluate(() => {
        if (window.audioCapture && typeof window.audioCapture.stopRecording === 'function') {
          window.audioCapture.stopRecording();
          return true;
        }
        return false;
      }).catch(error => {
        logger.warn(`Error stopping browser recording: ${error.message}`);
      });
    }
    
    // Close WebSocket connection if available
    if (wsConnection && typeof wsConnection.close === 'function') {
      logger.info('Closing WebSocket connection...');
      wsConnection.close();
      logger.info('WebSocket connection closed');
    }
    
    logger.info('Audio recording stopped successfully');
    return true;
  } catch (error) {
    logger.error(`Error stopping recording: ${error.message}`);
    throw error;
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