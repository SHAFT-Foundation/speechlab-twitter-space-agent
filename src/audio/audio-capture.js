const logger = require('../utils/logger');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AudioRecorder = require('node-audiorecorder');

/**
 * Setup audio capture from a Twitter Space
 * @param {Object} page - Playwright page with active Twitter Space
 * @returns {Promise<Object>} Audio capture object
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
      // Use a unique ID for this capture session
      const captureId = 'capture_' + Date.now();
      
      // Create audio context
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext({ sampleRate: 48000 });
      
      // Create audio destination for capturing
      const destination = audioContext.createMediaStreamDestination();
      
      // Create analyzer for monitoring audio levels
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 2048;
      analyzer.smoothingTimeConstant = 0.8;
      
      // Connect analyzer to destination
      analyzer.connect(destination);
      
      // Find and connect to audio elements
      const audioElements = Array.from(document.querySelectorAll('audio'));
      const videoElements = Array.from(document.querySelectorAll('video'));
      const mediaElements = [...audioElements, ...videoElements];
      
      console.log(`Found ${mediaElements.length} media elements`);
      
      if (mediaElements.length === 0) {
        console.warn('No audio or video elements found on the page');
      }
      
      // Connect each media element to our audio graph
      const mediaElementSources = mediaElements.map(element => {
        try {
          // Create media element source
          const source = audioContext.createMediaElementSource(element);
          
          // Connect to both the analyzer (for capture) and the default destination (for local playback)
          source.connect(analyzer);
          source.connect(audioContext.destination);
          
          return source;
        } catch (error) {
          console.error(`Error connecting media element: ${error.message}`);
          return null;
        }
      }).filter(source => source !== null);
      
      console.log(`Connected ${mediaElementSources.length} media element sources`);
      
      // Setup audio processing
      const scriptProcessor = audioContext.createScriptProcessor(4096, 2, 2);
      scriptProcessor.connect(audioContext.destination);
      
      // Store audio chunks
      const audioChunks = [];
      let isRecording = false;
      
      // Return the capture interface
      return {
        id: captureId,
        start: () => {
          isRecording = true;
          console.log('Audio recording started');
          return true;
        },
        stop: () => {
          isRecording = false;
          console.log('Audio recording stopped');
          return true;
        },
        isRecording: () => isRecording,
        getAudioContext: () => audioContext,
        getDestination: () => destination,
        getMediaStream: () => destination.stream,
        getConnectedSources: () => mediaElementSources.length,
        getAudioChunks: () => audioChunks,
        clearAudioChunks: () => {
          audioChunks.length = 0;
          return true;
        }
      };
    }).catch(error => {
      logger.error(`Error creating audio capture: ${error.message}`);
      throw new Error(`Failed to create audio capture: ${error.message}`);
    });
    
    if (!audioCaptureObj) {
      throw new Error('Failed to create audio capture');
    }
    
    // Create a temporary directory for recordings if it doesn't exist
    const recordingsDir = path.join(__dirname, '../../recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    
    // Create output file path
    const outputFile = path.join(recordingsDir, `twitter-space-${Date.now()}.wav`);
    
    // Create audio recorder
    const recorder = new AudioRecorder({
      program: 'sox',
      device: null,
      bits: 16,
      channels: 2,
      rate: 48000,
      type: 'wav'
    });
    
    // Create the complete audio capture object
    const audioCapture = {
      ...audioCaptureObj,
      page,
      recorder,
      outputFile,
      isHeadless: process.env.BROWSER_HEADLESS === 'true'
    };
    
    logger.info('Audio capture setup successfully');
    logger.debug(`Audio capture ID: ${audioCapture.id}`);
    logger.debug(`Connected sources: ${audioCapture.getConnectedSources}`);
    
    return audioCapture;
  } catch (error) {
    logger.error(`Failed to setup audio capture: ${error.message}`);
    throw error;
  }
}

/**
 * Start recording audio from the browser
 * @param {Object} audioCapture - Audio capture configuration
 * @param {Function} onData - Callback function for audio data chunks
 * @returns {Promise<void>}
 */
async function startRecording(audioCapture, onData) {
  logger.info('Starting audio recording...');
  
  try {
    const { recorder, outputFile, page, isHeadless } = audioCapture;
    
    // Unmute the page if it's muted
    await page.evaluate(() => {
      // Find and click the mute button if audio is muted
      const muteButton = document.querySelector('div[data-testid="muteButton"]');
      if (muteButton) {
        const ariaLabel = muteButton.getAttribute('aria-label') || '';
        if (ariaLabel.includes('Unmute')) {
          console.log('Unmuting Twitter Space audio...');
          muteButton.click();
        }
      }
      
      // Set volume to maximum for all audio elements
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(audio => {
        audio.volume = 1.0;
        
        // In headless mode, we need to ensure audio is playing
        if (!audio.paused) {
          console.log('Audio is already playing');
        } else {
          console.log('Attempting to play audio...');
          const playPromise = audio.play();
          if (playPromise) {
            playPromise.catch(e => console.error('Error playing audio:', e));
          }
        }
        
        // Log audio element details for debugging
        console.log('Audio element:', {
          src: audio.src,
          paused: audio.paused,
          muted: audio.muted,
          volume: audio.volume,
          duration: audio.duration,
          currentTime: audio.currentTime
        });
      });
      
      return {
        audioCount: document.querySelectorAll('audio').length,
        videoCount: document.querySelectorAll('video').length
      };
    }).then(counts => {
      logger.debug(`Found ${counts.audioCount} audio elements and ${counts.videoCount} video elements`);
    }).catch(err => {
      logger.warn(`Error while unmuting: ${err.message}`);
    });
    
    logger.debug('Audio unmuted, starting recorder...');
    
    // Create file stream
    const fileStream = fs.createWriteStream(outputFile, { encoding: 'binary' });
    
    // Start recording
    const audioStream = recorder.start().stream();
    
    // Handle data from the recorder
    audioStream.on('data', (chunk) => {
      // Write to file
      fileStream.write(chunk);
      
      // Forward data to callback if provided
      if (onData && typeof onData === 'function') {
        onData(chunk);
      }
    });
    
    // Handle errors
    audioStream.on('error', (err) => {
      logger.error(`Audio recording error: ${err.message}`);
    });
    
    // Log when recording starts
    recorder.on('start', () => {
      logger.info('Audio recording started successfully');
      logger.info(`Recording to file: ${outputFile}`);
    });
    
    // Log when recording stops
    recorder.on('stop', () => {
      logger.info('Audio recording stopped');
      fileStream.end();
    });
    
    // Return the streams for later cleanup
    return {
      ...audioCapture,
      stream: audioStream,
      fileStream: fileStream
    };
  } catch (error) {
    logger.error(`Failed to start audio recording: ${error.message}`);
    throw error;
  }
}

/**
 * Stop recording audio
 * @param {Object} audioCapture - Audio capture configuration
 * @returns {Promise<string>} Path to the recorded file
 */
async function stopRecording(audioCapture) {
  logger.info('Stopping audio recording...');
  
  try {
    const { recorder, outputFile, fileStream } = audioCapture;
    
    // Stop recording
    recorder.stop();
    
    // Close file stream if it exists
    if (fileStream && typeof fileStream.end === 'function') {
      fileStream.end();
    }
    
    logger.info(`Audio recording saved to: ${outputFile}`);
    return outputFile;
  } catch (error) {
    logger.error(`Failed to stop audio recording: ${error.message}`);
    throw error;
  }
}

module.exports = {
  setupAudioCapture,
  startRecording,
  stopRecording
}; 