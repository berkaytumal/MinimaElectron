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
      const asset = release.assets.find(a => a.name === 'minima.jar');
      if (!asset) {
        console.error('minima.jar not found in the latest release.');
        process.exit(1);
      }
      const hash = getHashFromReleaseBody(release.body, asset.name);
      if (!hash) {
        console.error('SHA-256 hash for minima.jar not found in release notes.');
        process.exit(1);
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
