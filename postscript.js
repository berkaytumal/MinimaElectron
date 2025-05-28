const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

// Configuration constants
const CONFIG = {
  API_URL: 'https://api.github.com/repos/minima-global/Minima/releases/latest',
  DEFAULT_JAR_URL: 'https://github.com/minima-global/Minima/releases/download/v1.0.0/minima.jar',
  DESTINATION: 'minima.jar',
  USER_AGENT: 'minima-electron-installer'
};

/**
 * Downloads a file from the given URL to the specified destination
 * Handles redirects automatically
 * @param {string} url - Source URL
 * @param {string} dest - Destination file path
 * @param {Function} cb - Callback on completion
 */
function downloadFile(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  
  https.get(url, (response) => {
    // Handle redirects
    if (response.statusCode === 302 && response.headers.location) {
      file.close();
      downloadFile(response.headers.location, dest, cb);
      return;
    }
    
    // Handle other HTTP errors
    if (response.statusCode !== 200) {
      file.close();
      fs.unlink(dest, () => {}); // Clean up failed download file
      console.error(`Failed to download minima.jar: HTTP ${response.statusCode}`);
      process.exit(1);
    }
    
    // Pipe response to file
    response.pipe(file);
    
    file.on('finish', () => {
      file.close(cb);
    });
  }).on('error', (err) => {
    fs.unlink(dest, () => {}); // Clean up failed download file
    console.error('Error downloading minima.jar:', err.message);
    process.exit(1);
  });
}

/**
 * Extracts SHA-256 hash from GitHub release body
 * @param {string} body - Release notes body
 * @param {string} jarName - JAR filename to find hash for
 * @returns {string|null} - Extracted hash or null
 */
function getHashFromReleaseBody(body, jarName) {
  // Find minima-*.jar: `0xHASH` or minima-*.jar: 0xHASH
  const regex = /minima[-\w\.]*\.jar: [`']?(0x)?([A-Fa-f0-9]{64})[`']?/;
  const match = body.match(regex);
  return match ? match[2].toLowerCase() : null;
}

/**
 * Calculates SHA-256 hash of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} - Hash as hex string (lowercase)
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

/**
 * Downloads the latest minima.jar or falls back to default
 */
async function downloadLatestMinima() {
  console.log('Fetching latest Minima release info...');
  
  const options = {
    headers: {
      'User-Agent': CONFIG.USER_AGENT
    }
  };
  
  try {
    // Fetch release info from GitHub API
    const releaseData = await new Promise((resolve, reject) => {
      let data = '';
      https.get(CONFIG.API_URL, options, (res) => {
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
    
    const release = JSON.parse(releaseData);
    
    // Check if release data is valid
    if (!release || !release.assets || !Array.isArray(release.assets)) {
      console.error('Invalid release data structure');
      return downloadDefaultJar();
    }
    
    // Find minima.jar in assets
    const asset = release.assets.find(a => a.name === 'minima.jar');
    if (!asset) {
      console.error('minima.jar not found in the latest release');
      return downloadDefaultJar();
    }
    
    // Extract hash from release body
    const hash = release.body ? getHashFromReleaseBody(release.body, asset.name) : null;
    
    // Check if we need to download the jar
    if (fs.existsSync(CONFIG.DESTINATION) && hash) {
      // Verify existing file hash
      try {
        const fileHash = await calculateFileHash(CONFIG.DESTINATION);
        if (fileHash === hash) {
          console.log('minima.jar is up to date and hash matches. Skipping download.');
          process.exit(0);
          return;
        }
      } catch (err) {
        console.error('Error checking existing file hash:', err.message);
        // Continue to download
      }
    }
    
    // Download the latest jar
    await new Promise((resolve) => {
      downloadFile(asset.browser_download_url, CONFIG.DESTINATION, resolve);
    });
    
    // Verify hash if available
    if (hash) {
      try {
        const fileHash = await calculateFileHash(CONFIG.DESTINATION);
        if (fileHash === hash) {
          console.log('minima.jar downloaded and hash verified.');
        } else {
          console.error('Downloaded minima.jar hash does not match expected hash!');
          process.exit(1);
        }
      } catch (err) {
        console.error('Error verifying downloaded file hash:', err.message);
        process.exit(1);
      }
    } else {
      console.log('SHA-256 hash not found in release. Skipping verification.');
    }
    
    process.exit(0);
    
  } catch (err) {
    console.error('Error processing release:', err.message);
    return downloadDefaultJar();
  }
}

/**
 * Downloads the default minima.jar as fallback
 */
function downloadDefaultJar() {
  console.log('Downloading default minima.jar...');
  downloadFile(CONFIG.DEFAULT_JAR_URL, CONFIG.DESTINATION, () => {
    console.log('Downloaded default minima.jar version');
    process.exit(0);
  });
}

// Start the download process
downloadLatestMinima();
