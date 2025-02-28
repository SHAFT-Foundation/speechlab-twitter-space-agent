#!/bin/bash

# Twitter Space Audio Capture - Setup Script
# This script installs all necessary dependencies for the Twitter Space Audio Capture tool

echo "Setting up Twitter Space Audio Capture..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 14.0.0 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d '.' -f 1)
if [ $NODE_MAJOR -lt 14 ]; then
    echo "Node.js version $NODE_VERSION is too old. Please install Node.js 14.0.0 or higher."
    exit 1
fi

echo "Node.js version $NODE_VERSION detected."

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Please install npm."
    exit 1
fi

echo "Installing npm dependencies..."
npm install

# Install Playwright browsers
echo "Installing Playwright browsers..."
npx playwright install chromium

# Check if SOX is installed (required for audio capture)
if ! command -v sox &> /dev/null; then
    echo "SOX is not installed. This is required for audio capture."
    echo "Please install SOX using your package manager:"
    echo "  - On macOS: brew install sox"
    echo "  - On Ubuntu/Debian: sudo apt-get install sox"
    echo "  - On Windows: Download from https://sourceforge.net/projects/sox/"
    exit 1
fi

echo "SOX is installed."

# Create necessary directories
echo "Creating necessary directories..."
mkdir -p logs
mkdir -p recordings
mkdir -p received-audio

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "Please edit the .env file with your credentials."
fi

echo "Running tests to verify installation..."
node test.js

echo "Setup complete!"
echo "To start the test WebSocket server: node test-server.js"
echo "To capture a Twitter Space: node src/index.js --url <twitter-space-url> --test-mode"
echo ""
echo "For more information, see the README.md file." 