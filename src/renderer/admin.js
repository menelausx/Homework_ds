// ==================== System Admin Module ====================
// User management: list, create, edit, delete, reset password.

var AdminModule = (function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────
  var moduleAdmin = document.getElementById('module-admin');
  var tableBody = document.getElementById('admin-table-body');
  var btnNewUser = document.getElementById('btn-admin-new-user');
  var btnSearch = document.getElementById('btn-admin-search');
  var btnRefresh = document.getElementById('btn-admin-refresh');
  var searchInput = document.getElementById('admin-search-input');
  var statUserCount = document.getElementById('stat-user-count');
  var btnPrev = document.getElementById('btn-admin-prev');
  var btnNext = document.getElementById('btn-admin-next');
  var pageInfo = document.getElementById('admin-page-info');

  // ── User modal ──────────────────────────────────────────────────────────
  var modalUser = document.getElementById('modal-user');
  var modalUserTitle = document.getElementById('modal-user-title');
  var modalUserId = document.getElementById('modal-user-id');
  var modalUsername = document.getElementById('modal-username');
  var modalPassword = document.getElementById('modal-user-password');
  var modalPasswordField = document.getElementById('modal-password-field');
  var modalUserStatus = document.getElementById('modal-user-status');
  var btnModalUserClose = document.getElementById('btn-modal-user-close');
  var btnModalUserCancel = document.getElementById('btn-modal-user-cancel');
  var btnModalUserSave = document.getElementById('btn-modal-user-save');

  // ── Password modal ──────────────────────────────────────────────────────
  var modalPasswordDlg = document.getElementById('modal-password');
  var modalPasswordUserId = document.getElementById('modal-password-user-id');
  var modalNewPassword = document.getElementById('modal-new-password');
  var modalPasswordStatus = document.getElementById('modal-password-status');
  var btnModalPasswordClose = document.getElementById('btn-modal-password-close');
  var btnModalPasswordCancel = document.getElementById('btn-modal-password-cancel');
  var btnModalPasswordSave = document.getElementById('btn-modal-password-save');

  // ── Confirm modal ───────────────────────────────────────────────────────
  var modalConfirm = document.getElementById('modal-confirm');
  var modalConfirmMessage = document.getElementById('modal-confirm-message');
  var btnModalConfirmClose = document.getElementById('btn-modal-confirm-close');
  var btnModalConfirmCancel = document.getElementById('btn-modal-confirm-cancel');
  var btnModalConfirmOk = document.getElementById('btn-modal-confirm-ok');

  // ── Internal state ──────────────────────────────────────────────────────
  var currentPage = 1;
  var totalPages = 1;
  var currentSearch = '';
  var pendingDeleteId = null;

  // ── Utility ─────────────────────────────────────────────────────────────

  function clearUserModalStatus() {
    if (modalUserStatus) {
      modalUserStatus.textContent = '';
      modalUserStatus.className = 'modal-status';
    }
  }

  function setUserModalStatus(msg, type) {
    if (modalUserStatus) {
      modalUserStatus.textContent = msg;
      modalUserStatus.className = 'modal-status ' + (type || '');
    }
  }

  function clearPasswordModalStatus() {
    if (modalPasswordStatus) {
      modalPasswordStatus.textContent = '';
      modalPasswordStatus.className = 'modal-status';
    }
  }

  function setPasswordModalStatus(msg, type) {
    if (modalPasswordStatus) {
      modalPasswordStatus.textContent = msg;
      modalPasswordStatus.className = 'modal-status ' + (type || '');
    }
  }

  function formatDateTime(text) {
    if (!text) return '--';
    try {
      // SQLite datetime format: "YYYY-MM-DD HH:MM:SS"
      var parts = text.split(' ');
      if (parts.length >= 2) {
        return parts[0] + ' ' + parts[1].substring(0, 5);
      }
      return text;
    } catch (_) {
      return text;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function renderTable(users) {
    if (!tableBody) return;

    if (!users || users.length === 0) {
      tableBody.innerHTML =
        '<tr class="admin-table-empty"><td colspan="6">暂无数据</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      html += '<tr>';
      html += '<td><span class="mono-cell">' + u.id + '</span></td>';
      html += '<td>' + escapeHtml(u.username) + '</td>';
      html += '<td><span class="role-badge">' + escapeHtml(u.role || 'admin') + '</span></td>';
      html += '<td>' + formatDateTime(u.created_at) + '</td>';
      html += '<td>' + formatDateTime(u.last_login) + '</td>';
      html +=
        '<td>' +
        '<div class="admin-actions">' +
        '<button class="admin-action-btn edit" data-action="edit" data-id="' +
        u.id +
        '" data-username="' +
        escapeAttr(u.username) +
        '">编辑</button>' +
        '<button class="admin-action-btn reset" data-action="reset" data-id="' +
        u.id +
        '" data-username="' +
        escapeAttr(u.username) +
        '">重置密码</button>' +
        '<button class="admin-action-btn delete" data-action="delete" data-id="' +
        u.id +
        '" data-username="' +
        escapeAttr(u.username) +
        '">删除</button>' +
        '</div>' +
        '</td>';
      html += '</tr>';
    }
    tableBody.innerHTML = html;
  }

  function updatePagination(page, total, totalCount) {
    currentPage = page;
    totalPages = Math.max(1, Math.ceil(total / 20));
    if (pageInfo) {
      pageInfo.textContent =
        '第 ' + currentPage + ' 页 / 共 ' + totalPages + ' 页（' + totalCount + ' 条记录）';
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
  }

  // ── Data loading ────────────────────────────────────────────────────────

  async function loadUsers() {
    try {
      var result = await window.electronAPI.listUsers({
        search: currentSearch,
        page: currentPage,
        limit: 20,
      });
      renderTable(result.users);
      updatePagination(result.page, result.total, result.total);
      if (statUserCount) statUserCount.textContent = result.total;
    } catch (err) {
      console.error('Admin: loadUsers error:', err);
      if (tableBody) {
        tableBody.innerHTML =
          '<tr class="admin-table-empty"><td colspan="6">加载失败: ' +
          escapeHtml(err.message) +
          '</td></tr>';
      }
    }
  }

  function refreshUsers() {
    currentPage = 1;
    currentSearch = searchInput ? searchInput.value.trim() : '';
    loadUsers();
  }

  // ── User Form Modal ─────────────────────────────────────────────────────

  function openNewUserModal() {
    if (modalUserId) modalUserId.value = '';
    if (modalUsername) modalUsername.value = '';
    if (modalPassword) modalPassword.value = '';
    if (modalUserTitle) modalUserTitle.textContent = '新建用户';
    if (modalPasswordField) modalPasswordField.style.display = '';
    if (modalPassword) modalPassword.placeholder = '请输入密码';
    clearUserModalStatus();
    if (modalUser) modalUser.style.display = '';
    if (modalUsername) modalUsername.focus();
  }

  function openEditUserModal(id, username) {
    if (modalUserId) modalUserId.value = id;
    if (modalUsername) modalUsername.value = username;
    if (modalPassword) modalPassword.value = '';
    if (modalUserTitle) modalUserTitle.textContent = '编辑用户';
    if (modalPasswordField) modalPasswordField.style.display = '';
    if (modalPassword) modalPassword.placeholder = '留空则不修改密码';
    clearUserModalStatus();
    if (modalUser) modalUser.style.display = '';
    if (modalUsername) modalUsername.focus();
  }

  function closeUserModal() {
    if (modalUser) modalUser.style.display = 'none';
  }

  async function saveUser() {
    clearUserModalStatus();

    var id = modalUserId ? modalUserId.value : '';
    var username = modalUsername ? modalUsername.value.trim() : '';
    var password = modalPassword ? modalPassword.value : '';

    if (!username) {
      setUserModalStatus('用户名不能为空', 'error');
      return;
    }

    if (id) {
      // Edit existing user
      try {
        var result = await window.electronAPI.updateUser(parseInt(id, 10), username, password || null);
        if (result.success) {
          closeUserModal();
          loadUsers();
        } else {
          setUserModalStatus(result.error || '修改失败', 'error');
        }
      } catch (err) {
        setUserModalStatus('修改失败: ' + err.message, 'error');
      }
    } else {
      // Create new user
      if (!password) {
        setUserModalStatus('密码不能为空', 'error');
        return;
      }
      try {
        var result = await window.electronAPI.createUser(username, password);
        if (result.success) {
          closeUserModal();
          loadUsers();
        } else {
          setUserModalStatus(result.error || '创建失败', 'error');
        }
      } catch (err) {
        setUserModalStatus('创建失败: ' + err.message, 'error');
      }
    }
  }

  // ── Password Reset Modal ────────────────────────────────────────────────

  function openPasswordModal(id, username) {
    if (modalPasswordUserId) modalPasswordUserId.value = id;
    if (modalNewPassword) modalNewPassword.value = '';
    clearPasswordModalStatus();
    if (modalPasswordDlg) modalPasswordDlg.style.display = '';
    if (modalNewPassword) modalNewPassword.focus();
  }

  function closePasswordModal() {
    if (modalPasswordDlg) modalPasswordDlg.style.display = 'none';
  }

  async function savePassword() {
    clearPasswordModalStatus();

    var id = modalPasswordUserId ? modalPasswordUserId.value : '';
    var newPassword = modalNewPassword ? modalNewPassword.value : '';

    if (!newPassword) {
      setPasswordModalStatus('密码不能为空', 'error');
      return;
    }

    try {
      var result = await window.electronAPI.resetUserPassword(parseInt(id, 10), newPassword);
      if (result.success) {
        closePasswordModal();
      } else {
        setPasswordModalStatus(result.error || '重置失败', 'error');
      }
    } catch (err) {
      setPasswordModalStatus('重置失败: ' + err.message, 'error');
    }
  }

  // ── Confirm Delete Modal ────────────────────────────────────────────────

  function openConfirmModal(id, username) {
    pendingDeleteId = id;
    if (modalConfirmMessage) {
      modalConfirmMessage.textContent =
        '确定要删除用户 "' + username + '" 吗？此操作不可撤销。';
    }
    if (modalConfirm) modalConfirm.style.display = '';
  }

  function closeConfirmModal() {
    pendingDeleteId = null;
    if (modalConfirm) modalConfirm.style.display = 'none';
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;

    try {
      var result = await window.electronAPI.deleteUser(pendingDeleteId);
      if (result.success) {
        closeConfirmModal();
        loadUsers();
      } else {
        closeConfirmModal();
        // Show a brief notification-style error
        if (typeof AppModule !== 'undefined' && AppModule.setStatus) {
          AppModule.setStatus('error', result.error || '删除失败');
        }
      }
    } catch (err) {
      closeConfirmModal();
      console.error('Admin: delete error:', err);
    }
  }

  // ── Event delegation for table action buttons ───────────────────────────

  if (tableBody) {
    tableBody.addEventListener('click', function (e) {
      var btn = e.target.closest('.admin-action-btn');
      if (!btn) return;

      var action = btn.getAttribute('data-action');
      var id = parseInt(btn.getAttribute('data-id'), 10);
      var username = btn.getAttribute('data-username');

      if (action === 'edit') {
        openEditUserModal(id, username);
      } else if (action === 'reset') {
        openPasswordModal(id, username);
      } else if (action === 'delete') {
        openConfirmModal(id, username);
      }
    });
  }

  // ── Event bindings ──────────────────────────────────────────────────────

  if (btnNewUser) btnNewUser.addEventListener('click', openNewUserModal);
  if (btnSearch) btnSearch.addEventListener('click', refreshUsers);
  if (btnRefresh) btnRefresh.addEventListener('click', refreshUsers);

  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') refreshUsers();
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', function () {
      if (currentPage > 1) {
        currentPage--;
        loadUsers();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', function () {
      if (currentPage < totalPages) {
        currentPage++;
        loadUsers();
      }
    });
  }

  // User modal events
  if (btnModalUserClose) btnModalUserClose.addEventListener('click', closeUserModal);
  if (btnModalUserCancel) btnModalUserCancel.addEventListener('click', closeUserModal);
  if (btnModalUserSave) btnModalUserSave.addEventListener('click', saveUser);

  // Password modal events
  if (btnModalPasswordClose) btnModalPasswordClose.addEventListener('click', closePasswordModal);
  if (btnModalPasswordCancel) btnModalPasswordCancel.addEventListener('click', closePasswordModal);
  if (btnModalPasswordSave) btnModalPasswordSave.addEventListener('click', savePassword);

  // Confirm modal events
  if (btnModalConfirmClose) btnModalConfirmClose.addEventListener('click', closeConfirmModal);
  if (btnModalConfirmCancel) btnModalConfirmCancel.addEventListener('click', closeConfirmModal);
  if (btnModalConfirmOk) btnModalConfirmOk.addEventListener('click', confirmDelete);

  // Close modals on overlay click
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.style.display = 'none';
    }
  });

  // Escape key closes modals
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modalUser && modalUser.style.display !== 'none') closeUserModal();
      if (modalPasswordDlg && modalPasswordDlg.style.display !== 'none') closePasswordModal();
      if (modalConfirm && modalConfirm.style.display !== 'none') closeConfirmModal();
    }
  });

  // ── Helper: HTML escaping ───────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Called when the admin tab is activated.
   */
  function onActivate() {
    loadUsers();
  }

  // ── Exports ─────────────────────────────────────────────────────────────
  return {
    onActivate: onActivate,
    loadUsers: loadUsers,
    refreshUsers: refreshUsers,
  };
})();
