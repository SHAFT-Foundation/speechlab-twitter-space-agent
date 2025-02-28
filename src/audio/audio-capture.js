const logger = require('../utils/logger');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AudioRecorder = require('node-audiorecorder');

/**
 * Setup audio capture from the browser
 * @param {Page} page - Playwright page with active Twitter Space
 * @returns {Object} Audio capture configuration
 */
async function setupAudioCapture(page) {
  logger.info('Setting up audio capture...');
  
  try {
    // For a hackathon solution, we'll use system audio recording
    // In a production environment, we might use:
    // 1. Browser extension to capture audio
    // 2. Virtual audio cable
    // 3. Chrome Remote Debugging Protocol to access audio stream
    
    const audioFormat = process.env.AUDIO_FORMAT || 'wav';
    const audioQuality = process.env.AUDIO_QUALITY || 'medium';
    
    logger.debug(`Audio format: ${audioFormat}, quality: ${audioQuality}`);
    
    // Ensure output directory exists
    const outputDir = path.join(process.cwd(), 'recordings');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    // Create unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(outputDir, `twitter-space-${timestamp}.${audioFormat}`);
    
    logger.debug(`Output file: ${outputFile}`);
    
    // Configure audio recorder options
    const options = {
      program: 'sox',       // Which program to use for recording
      device: null,         // Recording device (null = system default)
      bits: 16,             // Sample size
      channels: 2,          // Number of channels
      encoding: 'signed-integer',
      format: audioFormat,  // Format of the output file
      rate: 44100,          // Sample rate
      type: 'wav',          // Format type
      
      // Following are only relevant for 'mp3' format
      bitRate: 192,         // kbps
      
      // Silence settings
      silence: 0,           // Length of silence before stop recording
      
      // Thresholds
      thresholdStart: 0.1,  // Silence threshold to start recording
      thresholdStop: 0.1,   // Silence threshold to stop recording
      
      // Miscellaneous
      keepSilence: true,    // Keep silence in recording
    };
    
    // Adjust quality based on settings
    if (audioQuality === 'low') {
      options.rate = 22050;
      options.bitRate = 96;
    } else if (audioQuality === 'high') {
      options.rate = 48000;
      options.bitRate = 320;
    }
    
    // Initialize audioRecorder
    const audioRecorder = new AudioRecorder(options, logger);
    
    return {
      recorder: audioRecorder,
      outputFile: outputFile,
      format: audioFormat,
      quality: audioQuality,
      page: page
    };
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
    const { recorder, outputFile, page } = audioCapture;
    
    // Unmute the page if it's muted
    await page.evaluate(() => {
      // Find and click the mute button if audio is muted
      const muteButton = document.querySelector('div[data-testid="muteButton"]');
      if (muteButton) {
        const ariaLabel = muteButton.getAttribute('aria-label') || '';
        if (ariaLabel.includes('Unmute')) {
          muteButton.click();
        }
      }
      
      // Set volume to maximum
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(audio => {
        audio.volume = 1.0;
      });
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