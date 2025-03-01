# Twitter Space Audio Capture

A Node.js automation tool that captures audio from X(Twitter) Spaces and streams it to a WebSocket endpoint. A X(Twitter) Spaces live speech-to-speech interpretation agent that empowers everyone to participate and learn regardless of language.







## Features

- Automatically provisions an Azure VM with Chrome browser
- Logs into Twitter using provided credentials
- Joins a specified Twitter Space URL
- Captures the audio stream from the Twitter Space
- Streams the audio to a WebSocket endpoint in real-time
- Records the audio locally as a backup
- Cleans up resources when done

## Prerequisites

- Node.js 14.0.0 or higher
- Azure subscription with appropriate permissions
- Twitter account credentials
- SOX audio tool installed on the system (for audio capture)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/speechlab-twitter-space-agent.git
   cd speechlab-twitter-space-agent
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on the `.env.example` template:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file with your Azure credentials, Twitter login details, and WebSocket endpoint.

## Usage

Run the tool with a Twitter Space URL:

```
node src/index.js --url https://twitter.com/i/spaces/your-space-id
```

### Command Line Options

- `-u, --url <url>`: Twitter Space URL to join (required)
- `-w, --websocket <url>`: WebSocket endpoint to stream audio to (overrides .env setting)
- `-k, --keep-vm`: Keep the VM running after completion
- `-d, --debug`: Enable debug logging
- `-t, --test-mode`: Run in test mode without creating Azure VM (uses local browser)

### Multi-Space Capture

Capture audio from multiple Twitter Spaces simultaneously:

```bash
node multi-space-capture.js [options]
```

#### Options:
- `-u, --urls <urls>`: Comma-separated list of Twitter Space URLs to capture
- `-c, --count <count>`: Number of top spaces to capture if no URLs provided (default: 3)
- `-d, --debug`: Enable debug logging
- `-h, --headless`: Run in headless mode (default: false)
- `-b, --base-port <port>`: Base WebSocket server port (will increment for each space) (default: 8080)
- `-w, --websocket-urls <urls>`: Comma-separated list of WebSocket URLs to send audio to
- `-e, --websocket-base <url>`: Base WebSocket URL (will be appended with space index)

#### Examples:

```bash
# Capture the top 3 Twitter Spaces
node multi-space-capture.js

# Capture specific Twitter Spaces
node multi-space-capture.js --urls "https://twitter.com/i/spaces/1dRJZYWDNVrGB,https://twitter.com/i/spaces/1YqKDqVNLAVKV"

# Capture 5 top spaces with debug logging
node multi-space-capture.js --count 5 --debug

# Capture spaces and send to specific WebSocket endpoints
node multi-space-capture.js --urls "https://twitter.com/i/spaces/1dRJZYWDNVrGB,https://twitter.com/i/spaces/1YqKDqVNLAVKV" --websocket-urls "wss://example.com/audio1,wss://example.com/audio2"
```

## Architecture

The tool consists of several modules:

1. **Azure VM Manager**: Provisions and manages Azure VMs
2. **Browser Automation**: Controls the Chrome browser to log in to Twitter and join Spaces
3. **Audio Capture**: Records system audio while the Twitter Space is playing
4. **WebSocket Client**: Streams captured audio to the specified endpoint

## Hackathon Implementation Notes

This is a hackathon implementation designed for quick results. Some considerations:

- Audio capture is done via system audio recording (requires SOX)
- For production use, consider implementing a more robust audio capture method
- Error handling is basic but functional
- The VM provisioning process could be optimized for faster startup

## License

MIT
