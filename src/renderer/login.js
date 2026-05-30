// ==================== Login Module ====================
// Manages the login overlay: display, credential submission, and session restore.

var LoginModule = (function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────
  var loginOverlay = document.getElementById('login-overlay');
  var appContainer = document.getElementById('app-container');
  var loginStatus = document.getElementById('login-status');
  var defaultAdminHint = document.getElementById('login-default-hint');
  var btnLogin = document.getElementById('btn-login');
  var inputUsername = document.getElementById('login-username');
  var inputPassword = document.getElementById('login-password');
  var currentUserDisplay = document.getElementById('current-user-display');
  var tabLogout = document.getElementById('tab-logout');

  // ── Internal state ──────────────────────────────────────────────────────
  var currentUser = null;
  var showDefaultAdminHint = false;

  function showStatus(msg, type) {
    loginStatus.textContent = msg;
    loginStatus.className = 'login-status';
    if (type) loginStatus.classList.add(type);
  }

  function clearStatus() {
    loginStatus.textContent = '';
    loginStatus.className = 'login-status';
  }

  function showInitialAccountHint() {
    if (defaultAdminHint) {
      defaultAdminHint.style.display = '';
    }
    showStatus('请手动输入初始账号登录。', 'success');
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The currently logged-in user object (or null). */
  function getCurrentUser() {
    return currentUser;
  }

  /** Show the login overlay & hide the app. */
  function showLogin() {
    if (loginOverlay) loginOverlay.style.display = '';
    if (appContainer) appContainer.style.display = 'none';
    clearStatus();
    if (defaultAdminHint) defaultAdminHint.style.display = 'none';
    if (inputUsername) inputUsername.value = '';
    if (inputPassword) inputPassword.value = '';
    if (showDefaultAdminHint) {
      showInitialAccountHint();
    }
  }

  /** Hide the login overlay & show the app. */
  function hideLogin() {
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = '';
  }

  /**
   * Attempt to restore a previous session.
   * Returns true if auto-login succeeded, false otherwise.
   */
  async function tryRestoreSession() {
    try {
      var user = await window.electronAPI.getCurrentUser();
      if (user) {
        currentUser = user;
        if (currentUserDisplay) {
          currentUserDisplay.textContent = user.username;
        }
        hideLogin();
        return true;
      }
    } catch (err) {
      console.error('Session restore error:', err);
    }
    return false;
  }

  /**
   * Perform login with the given credentials.
   */
  async function doLogin(username, password) {
    clearStatus();

    if (!username || !username.trim()) {
      showStatus('请输入用户名', 'error');
      return false;
    }
    if (!password) {
      showStatus('请输入密码', 'error');
      return false;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = '登录中...';

    try {
      var result = await window.electronAPI.login(username, password);
      if (result.success) {
        currentUser = result.user;
        if (currentUserDisplay) {
          currentUserDisplay.textContent = result.user.username;
        }
        showStatus('登录成功', 'success');
        // Short delay so the user sees the success message
        setTimeout(function () {
          hideLogin();
          // Notify the main app module that login is complete
          if (typeof AppModule !== 'undefined' && AppModule.onLogin) {
            AppModule.onLogin(currentUser);
          }
        }, 400);
        return true;
      } else {
        showStatus(result.error || '登录失败', 'error');
        return false;
      }
    } catch (err) {
      showStatus('登录失败: ' + err.message, 'error');
      return false;
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = '登 录';
    }
  }

  /**
   * Perform logout.
   */
  async function doLogout() {
    try {
      await window.electronAPI.logout();
    } catch (_) {
      // Ignore errors during logout
    }
    currentUser = null;
    if (currentUserDisplay) {
      currentUserDisplay.textContent = '--';
    }
    // Notify the main app module
    if (typeof AppModule !== 'undefined' && AppModule.onLogout) {
      AppModule.onLogout();
    }
    showLogin();
  }

  // ── Event bindings ──────────────────────────────────────────────────────

  if (btnLogin) {
    btnLogin.addEventListener('click', function () {
      doLogin(inputUsername.value, inputPassword.value);
    });
  }

  // Enter key submits the login form
  if (inputPassword) {
    inputPassword.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        doLogin(inputUsername.value, inputPassword.value);
      }
    });
  }
  if (inputUsername) {
    inputUsername.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        // Move focus to password field
        if (inputPassword) inputPassword.focus();
      }
    });
  }

  // Logout tab click
  if (tabLogout) {
    tabLogout.addEventListener('click', function () {
      doLogout();
    });
  }

  // ── Auto-restore session on load ────────────────────────────────────────
  var bootstrapInfoReady = Promise.resolve();
  if (window.electronAPI && window.electronAPI.getBootstrapInfo) {
    bootstrapInfoReady = window.electronAPI
      .getBootstrapInfo()
      .then(function (info) {
        showDefaultAdminHint = !!(info && info.defaultAdminCreated);
      })
      .catch(function (err) {
        console.error('Bootstrap info error:', err);
      });
  }

  bootstrapInfoReady.then(function () {
    tryRestoreSession().then(function (loggedIn) {
      if (!loggedIn) {
        showLogin();
      } else {
        // Session restored successfully; the app should already be visible.
        // Notify AppModule if it exists.
        if (typeof AppModule !== 'undefined' && AppModule.onLogin) {
          AppModule.onLogin(currentUser);
        }
      }
    });
  });

  // ── Exports ─────────────────────────────────────────────────────────────
  return {
    getCurrentUser: getCurrentUser,
    showLogin: showLogin,
    hideLogin: hideLogin,
    doLogin: doLogin,
    doLogout: doLogout,
    tryRestoreSession: tryRestoreSession,
  };
})();
