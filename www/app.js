const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('container');

  // Function to show a loading message while Minima is starting up
  function showLoading() {
    container.innerHTML = `
      <div class="loading">
        <h3>Starting Minima...</h3>
        <p>Please wait while Minima is being initialized.</p>
      </div>
    `;
  }

  // Function to show options when Minima is already running
  function showMinimaAlreadyRunning() {
    container.innerHTML = `
      <div class="minima-already-running">
        <h3>Minima is Already Running</h3>
        <p>A Minima instance is already running on this system.</p>
        <div class="button-group">
          <button id="connect-button" class="primary-button">Connect to Existing Instance</button>
          <button id="restart-button" class="secondary-button">Restart Minima</button>
        </div>
      </div>
    `;
    // Add event listeners
    document.getElementById('connect-button').addEventListener('click', () => {
      ipcRenderer.send('connect-to-minima');
      showLoading();
    });

    document.getElementById('restart-button').addEventListener('click', () => {
      ipcRenderer.send('restart-minima');
      showLoading();
    });
  }

  // Function to show database lock error
  function showDatabaseLockError() {
    container.innerHTML = `
      <div class="minima-already-running error-container">
        <h3>Database Lock Error</h3>
        <p>Database may be already in use. Another Minima instance might be running on this system.</p>
        <div class="error-details">
          <pre>org.h2.jdbc.JdbcSQLNonTransientConnectionException: Database may be already in use.</pre>
        </div>
        <div class="button-group">
          <button id="restart-button" class="secondary-button">Restart Minima</button>
        </div>
      </div>
    `;

    document.getElementById('restart-button').addEventListener('click', () => {
      ipcRenderer.send('restart-minima');
      showLoading();
    });
  }

  // Function to show a password prompt
  function showPasswordPrompt() {
    container.innerHTML = `
      <div class="password-prompt">
        <h3>Set Minima MDS Password</h3>
        <div class="input-group">
          <input type="password" id="password-input" placeholder="Enter a password for Minima MDS" />
          <div class="error" id="error-message"></div>
          <button id="submit-button">Save & Start Minima</button>
        </div>
      </div>
    `;

    // Add event listeners
    document.getElementById('submit-button').addEventListener('click', () => {
      const password = document.getElementById('password-input').value;
      if (!password) {
        document.getElementById('error-message').textContent = 'Password is required';
        return;
      }
      ipcRenderer.send('set-password', password);
      showLoading();
    });

    // Allow enter key to submit
    document.getElementById('password-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('submit-button').click();
      }
    });
  }

  // Function to render a webview when Minima is ready
  function renderWebview() {
    if (!document.getElementById('minima-webview')) {
      const webview = document.createElement('webview');
      webview.id = 'minima-webview';
      webview.src = 'https://127.0.0.1:9003';
      webview.style = 'width:100vw; height:100vh; border:none;';

      // Set webpreferences
      webview.setAttribute('webpreferences', 'contextIsolation=no');
      webview.setAttribute('allowpopups', 'true');

      // Enable node integration in the webview
      webview.setAttribute('nodeintegration', 'true');

      // Add to DOM
      document.querySelector("#container").remove()
      document.body.appendChild(webview);

      // After adding to DOM, set up event listeners for the webview
      webview.addEventListener('dom-ready', () => {
        console.log('Webview DOM ready');

        // add style to webview body without injectCSS
        // Load the CSS file content as a string in app.js, then pass it to the webview
        fetch('webview.css')
          .then(response => response.text())
          .then(cssContent => {
            webview.executeJavaScript(`
              const style = document.createElement('style');
              style.textContent = \`${cssContent.replace(/`/g, '\\`')}\`;
              document.head.appendChild(style);
            `);
          })
          .catch(err => {
            console.error('Failed to load webview.css:', err);
          });
      });

      webview.addEventListener('did-fail-load', (event) => {
        console.error('Webview failed to load:', event);
        if (event.errorCode === -202) { // Certificate error
          console.log('Certificate error detected, will retry with bypass');
          // We'll let the main process handle this
        }
      });
    }
  }

  // Listen for show password prompt event
  ipcRenderer.on('show-password-prompt', () => {
    showPasswordPrompt();
  });

  // Listen for Minima already running event
  ipcRenderer.on('minima-already-running', () => {
    showMinimaAlreadyRunning();
  });

  // Listen for database lock error event
  ipcRenderer.on('database-lock-error', () => {
    showDatabaseLockError();
  });

  // Listen for Minima ready event
  ipcRenderer.on('minima-ready', () => {
    renderWebview();
  });

  // Listen for password errors
  ipcRenderer.on('password-error', (_, msg) => {
    if (msg) {
      const errorElement = document.getElementById('error-message');
      if (errorElement) {
        errorElement.textContent = msg;
      } else {
        alert(msg);
      }
    }
  });

  // Show loading message by default
  showLoading();
});