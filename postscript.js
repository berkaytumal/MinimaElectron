const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const apiUrl = 'https://api.github.com/repos/minima-global/Minima/releases/latest';

function downloadFile(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (response) => {
    if (response.statusCode === 302 && response.headers.location) {
      downloadFile(response.headers.location, dest, cb);
      return;
    }
    if (response.statusCode !== 200) {
      console.error(`Failed to download minima.jar: ${response.statusCode}`);
      process.exit(1);
    }
    response.pipe(file);
    file.on('finish', () => {
      file.close(cb);
    });
  }).on('error', (err) => {
    fs.unlink(dest, () => {});
    console.error('Error downloading minima.jar:', err.message);
    process.exit(1);
  });
}

function getHashFromReleaseBody(body, jarName) {
  // Find minima-*.jar: `0xHASH` or minima-*.jar: 0xHASH
  const regex = /minima[-\w\.]*\.jar: [`']?(0x)?([A-Fa-f0-9]{64})[`']?/;
  const match = body.match(regex);
  return match ? match[2].toLowerCase() : null;
}

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

function loadHash() {
  return null; // Always force hash check from online, never use a saved hash
}

const options = {
  headers: {
    'User-Agent': 'minima-electron-installer'
  }
};

console.log('Fetching latest Minima release info...');
https.get(apiUrl, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', async () => {
    try {
      const release = JSON.parse(data);
      
      // Add defensive checks to ensure assets exists
      if (!release || !release.assets || !Array.isArray(release.assets)) {
        console.error('Invalid release data structure:', JSON.stringify(release, null, 2).substring(0, 500) + '...');
        console.log('Downloading default minima.jar...');
        // Use a hardcoded URL to download from a known location as fallback
        downloadFile('https://github.com/minima-global/Minima/releases/download/v1.0.0/minima.jar', 'minima.jar', () => {
          console.log('Downloaded default minima.jar version');
          process.exit(0);
        });
        return;
      }
      
      const asset = release.assets.find(a => a.name === 'minima.jar');
      if (!asset) {
        console.error('minima.jar not found in the latest release.');
        console.log('Downloading default minima.jar...');
        // Use a hardcoded URL as fallback
        downloadFile('https://github.com/minima-global/Minima/releases/download/v1.0.0/minima.jar', 'minima.jar', () => {
          console.log('Downloaded default minima.jar version');
          process.exit(0);
        });
        return;
      }
      
      const hash = release.body ? getHashFromReleaseBody(release.body, asset.name) : null;
      if (!hash) {
        console.log('SHA-256 hash for minima.jar not found in release notes. Skipping hash verification.');
        // Download without hash verification
        downloadFile(asset.browser_download_url, 'minima.jar', () => {
          console.log('minima.jar downloaded successfully (hash verification skipped).');
          process.exit(0);
        });
        return;
      }
      const currentHash = loadHash();
      let shouldDownload = true;
      if (fs.existsSync('minima.jar')) {
        // Verify file hash matches
        const fileHash = await calculateFileHash('minima.jar');
        if (fileHash === hash) {
          console.log('minima.jar is up to date and hash matches. Skipping download.');
          process.exit(0);
        }
      }
      // Download and update hash after success
      downloadFile(asset.browser_download_url, 'minima.jar', async () => {
        const fileHash = await calculateFileHash('minima.jar');
        if (fileHash === hash) {
          console.log('minima.jar downloaded and hash verified.');
          process.exit(0);
        } else {
          console.error('Downloaded minima.jar hash does not match expected hash!');
          process.exit(1);
        }
      });
    } catch (e) {
      console.error('Failed to parse release info:', e);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('Error fetching release info:', err.message);
  process.exit(1);
});
