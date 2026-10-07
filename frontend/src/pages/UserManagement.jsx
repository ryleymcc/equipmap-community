import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  Users, UserPlus, Plus, Trash2, Shield, Edit2, X, Check,
  Menu, User as UserIcon, ShieldAlert, Wrench,
  MapPin, Sparkles, RotateCcw, Search, Mail
} from 'lucide-react';
import { api, getErrorMessage } from '../api';
import DashboardLeftDrawer from '../components/DashboardLeftDrawer';

export default function UserManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, isAdmin, loading } = useAuth();

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [prevSearchParam, setPrevSearchParam] = useState(searchParams.get('search'));
  const [usersSearchQuery, setUsersSearchQuery] = useState(() => {
    return searchParams.get('search') || '';
  });
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);

  const currentSearchParam = searchParams.get('search');
  if (currentSearchParam !== prevSearchParam) {
    setPrevSearchParam(currentSearchParam);
    setUsersSearchQuery(currentSearchParam || '');
  }

  // Create User Modal
  const [isAddModalOpen, setIsUploadModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('technician');
  const [newTrade, setNewTrade] = useState('');
  const [newCanManageItems, setNewCanManageItems] = useState(true);
  const [newCanUndoAllAuditLogs, setNewCanUndoAllAuditLogs] = useState(false);
  const [newIsActive, setNewIsActive] = useState(true);
  const [formError, setFormError] = useState('');

  // Edit User Modal
  const [editingUser, setEditingUser] = useState(null);
  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('technician');
  const [editTrade, setEditTrade] = useState('');
  const [editCanManageItems, setEditCanManageItems] = useState(true);
  const [editCanUndoAllAuditLogs, setEditCanUndoAllAuditLogs] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/api/users');
      setUsers(res.data);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash
          },
          originalFrom: location.state?.from ? {
            pathname: location.state.from.pathname,
            search: location.state.from.search,
            hash: location.state.from.hash
          } : undefined,
          requiredRole: 'admin'
        }
      });
    }
  }, [loading, isAdmin, navigate, location]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.get('/api/users')
      .then(res => {
        if (!cancelled) setUsers(res.data);
      })
      .catch(error => {
        if (!cancelled) console.error('Failed to load users:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const activeAdminsCount = users.filter(u => u.role === 'admin' && u.is_active).length;

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFormError('');
    const isAdm = newRole === 'admin';
    const isViewer = newRole === 'viewer';
    try {
      await api.post('/api/users', {
        username: newUsername.trim(),
        full_name: newFullName.trim() || null,
        email: newEmail.trim() || null,
        password: newPassword,
        role: newRole,
        trade: newTrade.trim() || null,
        can_manage_items: isAdm ? true : (isViewer ? false : newCanManageItems),
        can_undo_all_audit_logs: isAdm ? true : (isViewer ? false : newCanUndoAllAuditLogs),
        is_active: newIsActive
      });
      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('technician');
      setNewTrade('');
      setNewCanManageItems(true);
      setNewCanUndoAllAuditLogs(false);
      setNewIsActive(true);
      setIsUploadModalOpen(false);
      loadUsers();
    } catch (error) {
      setFormError(getErrorMessage(error, 'Failed to create user'));
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    setFormError('');
    const isEditingAdmin = editingUser?.role === 'admin';
    const isAdm = isEditingAdmin ? true : editRole === 'admin';
    const isViewer = isEditingAdmin ? false : editRole === 'viewer';
    try {
      const payload = {
        username: editUsername.trim(),
        full_name: editFullName.trim() || null,
        email: editEmail.trim() || null,
        role: isEditingAdmin ? 'admin' : editRole,
        trade: editTrade.trim() || null,
        can_manage_items: isAdm ? true : (isViewer ? false : editCanManageItems),
        can_undo_all_audit_logs: isAdm ? true : (isViewer ? false : editCanUndoAllAuditLogs),
        is_active: isEditingAdmin ? true : editIsActive,
      };
      if (editPassword) {
        payload.password = editPassword;
      }

      await api.put(`/api/users/${editingUser.id}`, payload);
      setEditingUser(null);
      setEditPassword('');
      loadUsers();
    } catch (error) {
      setFormError(getErrorMessage(error, 'Failed to update user'));
    }
  };

  const startEditUser = (u) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditFullName(u.full_name || '');
    setEditEmail(u.email || '');
    setEditRole(u.role === 'editor' ? 'technician' : u.role);
    setEditTrade(u.trade || '');
    setEditCanManageItems(u.can_manage_items !== false || u.role === 'editor');
    setEditCanUndoAllAuditLogs(Boolean(u.can_undo_all_audit_logs));
    setEditIsActive(u.is_active !== false);
    setEditPassword('');
    setFormError('');
  };

  const handleToggleUserActive = async (u) => {
    if (u.id === user.id) {
      alert("You cannot deactivate your own account");
      return;
    }
    if (u.role === 'admin' && u.is_active && activeAdminsCount <= 1) {
      alert("Cannot deactivate the only active administrator. There must be at least one active administrator in the system.");
      return;
    }
    const actionText = u.is_active ? 'deactivate' : 'activate';
    if (!window.confirm(`Are you sure you want to ${actionText} user "${u.username}"?`)) return;
    try {
      await api.put(`/api/users/${u.id}`, {
        is_active: !u.is_active
      });
      // On deactivation, also revoke all active sessions for immediate offboarding
      if (u.is_active) {
        try {
          await api.post(`/api/users/${u.id}/revoke-sessions`);
        } catch (revokeErr) {
          console.warn('Session revocation failed during deactivation:', revokeErr);
        }
      }
      loadUsers();
    } catch (error) {
      alert(getErrorMessage(error, `Failed to ${actionText} user`));
    }
  };

  const handleRevokeUserSessions = async (u) => {
    if (u.id === user.id) {
      alert("You cannot revoke your own sessions");
      return;
    }
    if (!window.confirm(`Are you sure you want to revoke all active sessions for "${u.username}"? They will be logged out immediately.`)) return;
    try {
      await api.post(`/api/users/${u.id}/revoke-sessions`);
      alert(`All sessions for "${u.username}" have been revoked.`);
    } catch (error) {
      alert(getErrorMessage(error, 'Failed to revoke sessions'));
    }
  };

  const handleDeleteUser = async (userId) => {
    if (userId === user.id) {
      alert("You cannot delete yourself");
      return;
    }
    const targetUser = users.find(u => u.id === userId);
    if (targetUser?.role === 'admin' && targetUser?.is_active && activeAdminsCount <= 1) {
      alert("Cannot delete the only active administrator. There must be at least one active administrator in the system.");
      return;
    }
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await api.delete(`/api/users/${userId}`);
      loadUsers();
    } catch (error) {
      alert(getErrorMessage(error, 'Failed to delete user'));
    }
  };

  // Filtered users
  const filteredUsers = users.filter(u => {
    if (!usersSearchQuery.trim()) return true;
    const q = usersSearchQuery.toLowerCase();
    return (
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.full_name && u.full_name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q)) ||
      (u.trade && u.trade.toLowerCase().includes(q))
    );
  });

  if (loading || !isAdmin) return null;

  return (
    <div className="app-layout">
      <DashboardLeftDrawer
        isOpen={isLeftDrawerOpen}
        onClose={() => setIsLeftDrawerOpen(false)}
        activeView="users"
      />

      <div className="main-content">
        <header className="app-header dashboard-header">
          <button className="trigger-btn" onClick={() => setIsLeftDrawerOpen(true)} title="Open Menu">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-md ml-md flex-1">
            <div className="flex items-center gap-xs">
              <Users size={22} color="var(--primary-color)" />
              <h1 className="text-lg font-semibold m-0">User Management</h1>
            </div>
          </div>

          {isAdmin && (
            <button
              className="btn btn-primary btn-sm gap-xs"
              onClick={() => setIsUploadModalOpen(true)}
              title="Add User"
              style={{ borderRadius: '8px' }}
            >
              <Plus size={16} />
              <span>Add User</span>
            </button>
          )}
        </header>

        <div className="list-view-container">
          {isLoading ? (
            <div className="flex-center p-2xl">
              <div className="loader">Loading users...</div>
            </div>
          ) : (
            <div className="flex-column gap-md">
                {/* Users Search Bar */}
                <div className="flex-between items-center gap-md flex-wrap">
                  <div className="search-bar-wrap" style={{ maxWidth: '360px', width: '100%', position: 'relative' }}>
                    <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Search users by name, email, role, or trade..."
                      value={usersSearchQuery}
                      onChange={e => setUsersSearchQuery(e.target.value)}
                      style={{ paddingLeft: '2.25rem', height: '38px', borderRadius: '8px' }}
                    />
                    {usersSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setUsersSearchQuery('')}
                        style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="text-xs text-muted">
                    Showing {filteredUsers.length} of {users.length} registered users
                  </div>
                </div>

                {filteredUsers.length === 0 ? (
                  <div className="flex-column flex-center p-2xl text-center glass-panel" style={{ borderRadius: '12px' }}>
                    <UserIcon size={36} className="text-muted mb-sm opacity-50" />
                    <h3 className="text-md font-semibold text-foreground m-0">No Users Found</h3>
                    <p className="text-xs text-muted mt-xs mb-md">
                      {usersSearchQuery ? `No users match "${usersSearchQuery}"` : 'No users registered yet.'}
                    </p>
                    {usersSearchQuery ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => setUsersSearchQuery('')}>
                        Clear Search Filter
                      </button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => setIsUploadModalOpen(true)}>
                        <Plus size={15} />
                        <span>Add New User</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop Table View */}
                    <div className="table-desktop-view">
                      <div className="list-table-wrapper">
                        <table className="list-table">
                          <thead>
                            <tr>
                              <th>Employee / User</th>
                              <th>Email Address</th>
                              <th>Role</th>
                              <th>Trade</th>
                              <th>Granular Permissions</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredUsers.map(u => {
                              const isAdm = u.role === 'admin';
                              const isOnlyAdminUser = u.role === 'admin' && u.is_active && activeAdminsCount <= 1;
                              return (
                                <tr key={u.id}>
                                  <td className="font-medium">
                                    <div className="flex-column" style={{ gap: '0.15rem' }}>
                                      <div className="flex items-center gap-xs">
                                        <span className="font-semibold text-foreground">{u.full_name || u.username}</span>
                                        {u.id === user.id && <span className="text-2xs text-muted font-normal">(You)</span>}
                                      </div>
                                      {u.full_name && (
                                        <span className="text-xs text-muted font-mono">{u.username}</span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    {u.email ? (
                                      <a
                                        href={`mailto:${u.email}`}
                                        className="flex items-center gap-xs text-xs text-secondary hover:text-primary transition-colors"
                                        style={{ textDecoration: 'none', width: 'fit-content' }}
                                        title={`Send email to ${u.email}`}
                                      >
                                        <Mail size={12} className="text-primary opacity-80" />
                                        <span className="font-mono">{u.email}</span>
                                      </a>
                                    ) : (
                                      <span className="text-muted text-xs">—</span>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`role-tag role-${u.role === 'editor' ? 'technician' : u.role}`}>
                                      {(u.role === 'editor' ? 'technician' : u.role).toUpperCase()}
                                    </span>
                                  </td>
                                  <td>
                                    {u.trade ? (
                                      <span
                                        className="permission-pill badge-info cursor-pointer hover:opacity-80"
                                        style={{ width: 'fit-content', cursor: 'pointer', transition: 'all 0.15s ease' }}
                                        onClick={() => setUsersSearchQuery(u.trade)}
                                        title={`Filter users by trade "${u.trade}"`}
                                      >
                                        <Wrench size={11} />
                                        <span>{u.trade}</span>
                                      </span>
                                    ) : (
                                      <span className="text-muted text-xs">—</span>
                                    )}
                                  </td>
                                  <td>
                                    {isAdm ? (
                                      <span className="badge badge-info text-2xs uppercase font-bold" style={{ padding: '0.3rem 0.75rem' }}>
                                        Full Administrative Access
                                      </span>
                                    ) : (
                                      <div className="permission-pills-wrap">
                                        {(u.can_manage_items !== false || u.role === 'editor') && (
                                          <span className="permission-pill badge-success" title="Can manage floorplan rooms, equipment, and pins">
                                            <MapPin size={11} />
                                            <span>Manage Items</span>
                                          </span>
                                        )}
                                        {u.can_undo_all_audit_logs && (
                                          <span className="permission-pill badge-purple" title="Can undo all audit records">
                                            <RotateCcw size={11} />
                                            <span>Undo All Audits</span>
                                          </span>
                                        )}
                                        {u.can_manage_items === false && !u.can_undo_all_audit_logs && (
                                          <span className="text-muted text-xs">Read Only</span>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className={`badge ${u.is_active ? 'badge-success' : 'badge-secondary'}`}
                                      onClick={() => handleToggleUserActive(u)}
                                      disabled={u.id === user.id || isOnlyAdminUser}
                                      title={u.id === user.id ? 'You cannot deactivate your own account' : (isOnlyAdminUser ? 'Cannot deactivate the only active administrator' : `Click to change status to ${u.is_active ? 'Inactive' : 'Active'}`)}
                                      style={{
                                        cursor: (u.id === user.id || isOnlyAdminUser) ? 'not-allowed' : 'pointer',
                                        opacity: (u.id === user.id || isOnlyAdminUser) ? 0.75 : 1,
                                        border: 'none',
                                        padding: '0.35rem 0.65rem',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.15s ease'
                                      }}
                                    >
                                      <div className={`badge-dot ${u.is_active ? 'active' : 'inactive'}`} />
                                      <span>{u.is_active ? 'Active' : 'Inactive'}</span>
                                    </button>
                                  </td>
                                  <td>
                                    <div className="flex-row gap-sm">
                                      <button className="row-action-btn" onClick={() => startEditUser(u)} title="Edit User">
                                        <Edit2 size={16} />
                                      </button>
                                      {u.id !== user.id && (
                                        <button
                                          className="row-action-btn"
                                          onClick={() => handleRevokeUserSessions(u)}
                                          title="Revoke All Sessions"
                                          style={{ color: 'var(--color-warning, #f59e0b)' }}
                                        >
                                          <ShieldAlert size={16} />
                                        </button>
                                      )}
                                      {u.id !== user.id && (
                                        <button
                                          className="row-action-btn delete-btn"
                                          onClick={() => handleDeleteUser(u.id)}
                                          disabled={isOnlyAdminUser}
                                          title={isOnlyAdminUser ? 'Cannot delete the only active administrator' : 'Delete User'}
                                          style={{ opacity: isOnlyAdminUser ? 0.4 : 1, cursor: isOnlyAdminUser ? 'not-allowed' : 'pointer' }}
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Mobile Card List View */}
                    <div className="table-mobile-view">
                      {filteredUsers.map(u => {
                        const isAdm = u.role === 'admin';
                        const isOnlyAdminUser = u.role === 'admin' && u.is_active && activeAdminsCount <= 1;
                        return (
                          <div key={u.id} className="table-mobile-card glass-panel" style={{ padding: '1rem', gap: '0.75rem' }}>
                            {/* Header row: Username + Role + Status & Actions */}
                            <div className="flex-between items-start gap-sm">
                              <div className="flex-column gap-2xs">
                                <div className="font-semibold text-foreground text-sm flex items-center gap-xs">
                                  <UserIcon size={15} className="text-primary" />
                                  <span>{u.full_name || u.username}</span>
                                  {u.id === user.id && <span className="text-2xs text-muted font-normal">(You)</span>}
                                </div>
                                {u.full_name && (
                                  <span className="text-2xs text-muted font-mono" style={{ marginLeft: '1.25rem' }}>{u.username}</span>
                                )}
                                {u.email && (
                                  <a
                                    href={`mailto:${u.email}`}
                                    className="flex items-center gap-xs text-2xs text-secondary hover:text-primary"
                                    style={{ textDecoration: 'none', marginLeft: '1.25rem', marginTop: '1px' }}
                                  >
                                    <Mail size={11} className="text-primary opacity-80" />
                                    <span className="font-mono">{u.email}</span>
                                  </a>
                                )}
                                <div className="flex items-center gap-xs flex-wrap mt-2xs">
                                  <span className={`role-tag role-${u.role === 'editor' ? 'technician' : u.role}`}>
                                    {(u.role === 'editor' ? 'technician' : u.role).toUpperCase()}
                                  </span>
                                  {u.trade && (
                                    <span
                                      className="permission-pill badge-info cursor-pointer hover:opacity-80"
                                      style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', cursor: 'pointer', transition: 'all 0.15s ease' }}
                                      onClick={() => setUsersSearchQuery(u.trade)}
                                      title={`Filter users by trade "${u.trade}"`}
                                    >
                                      <Wrench size={10} />
                                      <span>{u.trade}</span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-xs flex-wrap justify-end">
                                <button
                                  type="button"
                                  className={`badge ${u.is_active ? 'badge-success' : 'badge-secondary'}`}
                                  onClick={() => handleToggleUserActive(u)}
                                  disabled={u.id === user.id || isOnlyAdminUser}
                                  title={u.id === user.id ? 'You cannot deactivate your own account' : (isOnlyAdminUser ? 'Cannot deactivate the only active administrator' : `Click to change status to ${u.is_active ? 'Inactive' : 'Active'}`)}
                                  style={{
                                    cursor: (u.id === user.id || isOnlyAdminUser) ? 'not-allowed' : 'pointer',
                                    opacity: (u.id === user.id || isOnlyAdminUser) ? 0.75 : 1,
                                    border: 'none',
                                    padding: '0.35rem 0.65rem',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <div className={`badge-dot ${u.is_active ? 'active' : 'inactive'}`} />
                                  <span>{u.is_active ? 'Active' : 'Inactive'}</span>
                                </button>

                                <button className="row-action-btn" onClick={() => startEditUser(u)} title="Edit User">
                                  <Edit2 size={16} />
                                </button>
                                {u.id !== user.id && (
                                  <button
                                    className="row-action-btn"
                                    onClick={() => handleRevokeUserSessions(u)}
                                    title="Revoke All Sessions"
                                    style={{ color: 'var(--color-warning, #f59e0b)' }}
                                  >
                                    <ShieldAlert size={16} />
                                  </button>
                                )}
                                {u.id !== user.id && (
                                  <button
                                    className="row-action-btn delete-btn"
                                    onClick={() => handleDeleteUser(u.id)}
                                    disabled={isOnlyAdminUser}
                                    title={isOnlyAdminUser ? 'Cannot delete the only active administrator' : 'Delete User'}
                                    style={{ opacity: isOnlyAdminUser ? 0.4 : 1, cursor: isOnlyAdminUser ? 'not-allowed' : 'pointer' }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Granular Permissions on Mobile */}
                            {isAdm ? (
                              <div className="pt-xs" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                <span className="badge badge-info text-2xs uppercase font-bold" style={{ padding: '0.25rem 0.5rem' }}>
                                  Full Admin Access
                                </span>
                              </div>
                            ) : (
                              <div className="permission-pills-wrap pt-xs" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                {(u.can_manage_items !== false || u.role === 'editor') && (
                                  <span className="permission-pill badge-success" title="Can manage floorplan rooms, equipment, and pins">
                                    <MapPin size={11} />
                                    <span>Manage Items</span>
                                  </span>
                                )}
                                {u.can_undo_all_audit_logs && (
                                  <span className="permission-pill badge-purple" title="Can undo all audit records">
                                    <RotateCcw size={11} />
                                    <span>Undo All Audits</span>
                                  </span>
                                )}
                                {u.can_manage_items === false && !u.can_undo_all_audit_logs && (
                                  <span className="text-muted text-xs">Read Only</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
        </div>
      </div>

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setIsUploadModalOpen(false)} style={{ zIndex: 1200 }}>
          <div
            className="modal-card modal-lg glass-panel"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <UserPlus size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Add New User</h2>
                  <div className="text-xs text-muted">Create a new technician, admin, or viewer account</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setIsUploadModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="modal-card-body">
              {formError && (
                <div className="alert-box-danger text-sm p-sm rounded-md">
                  {formError}
                </div>
              )}
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Username</label>
                <input
                  type="text"
                  className="input-field"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="e.g. jdoe_tech"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                  <span>Full Name</span>
                  <span className="text-2xs text-muted font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newFullName}
                  onChange={e => setNewFullName(e.target.value)}
                  autoComplete="off"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                  <span>Email Address</span>
                  <span className="text-2xs text-muted font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  autoComplete="off"
                  placeholder="e.g. john.doe@hospital.org"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Enter strong password"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Role</label>
                <select className="input-field" value={newRole} onChange={e => setNewRole(e.target.value)}>
                  <option value="technician">Technician (Configurable Permissions)</option>
                  <option value="admin">Admin (Full access + user management)</option>
                  <option value="viewer">Viewer (Read-Only)</option>
                </select>
              </div>

              <div className="input-group">
                <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                  <span>Assigned Trade / Specialty</span>
                  <span className="text-2xs text-muted font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newTrade}
                  onChange={e => setNewTrade(e.target.value)}
                  placeholder="e.g. Electrical, HVAC, Plumbing"
                />
                <span className="text-2xs text-muted">Craft or department specialty.</span>
              </div>

              {/* Role-Specific Permissions Config */}
              {newRole === 'technician' ? (
                <div className="p-md rounded-lg flex-column gap-sm" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div className="flex items-center gap-xs mb-2xs">
                    <Sparkles size={16} color="#3b82f6" />
                    <span className="text-xs font-bold text-foreground">Technician Permissions</span>
                  </div>

                  <label className="flex items-center gap-sm cursor-pointer p-xs rounded hover-bg-subtle">
                    <input
                      type="checkbox"
                      checked={newCanManageItems}
                      onChange={e => setNewCanManageItems(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <div>
                      <div className="text-xs font-semibold text-foreground flex items-center gap-xs">
                        <MapPin size={13} className="text-green" />
                        <span>Manage Floorplan Items</span>
                      </div>
                      <div className="text-2xs text-muted">Allow adding and editing rooms, equipment, pins, and calibration points.</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-sm cursor-pointer p-xs rounded hover-bg-subtle">
                    <input
                      type="checkbox"
                      checked={newCanUndoAllAuditLogs}
                      onChange={e => setNewCanUndoAllAuditLogs(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <div>
                      <div className="text-xs font-semibold text-foreground flex items-center gap-xs">
                        <RotateCcw size={13} color="#c084fc" />
                        <span>Undo All Audit Records</span>
                      </div>
                      <div className="text-2xs text-muted">Allow undoing actions performed by any user. Otherwise, only own actions can be undone.</div>
                    </div>
                  </label>
                </div>
              ) : newRole === 'admin' ? (
                <div className="p-sm rounded-lg flex items-center gap-sm" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                  <Shield size={16} color="#60a5fa" />
                  <span className="text-xs text-secondary">Admins have all permissions and full user management access enabled by default.</span>
                </div>
              ) : (
                <div className="p-sm rounded-lg flex items-center gap-sm" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <Users size={16} className="text-muted" />
                  <span className="text-xs text-muted">Viewers have read-only access to floorplans, equipment, and public data. All editing and administrative permissions are disabled.</span>
                </div>
              )}

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsUploadModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <UserPlus size={14} />
                  <span>Create User</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setEditingUser(null)} style={{ zIndex: 1200 }}>
          <div
            className="modal-card modal-lg glass-panel"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Edit2 size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Edit User: {editingUser.username}</h2>
                  <div className="text-xs text-muted">Update profile, role, trade, and permissions</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setEditingUser(null)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="modal-card-body">
              {formError && (
                <div className="alert-box-danger text-sm p-sm rounded-md">
                  {formError}
                </div>
              )}
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">Username</label>
                <input
                  type="text"
                  className="input-field"
                  value={editUsername}
                  onChange={e => setEditUsername(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                  <span>Full Name</span>
                  <span className="text-2xs text-muted font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={editFullName}
                  onChange={e => setEditFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                  <span>Email Address</span>
                  <span className="text-2xs text-muted font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="e.g. john.doe@hospital.org"
                />
              </div>
              <div className="input-group">
                <label className="text-xs font-semibold text-secondary">New Password (Leave blank to keep current)</label>
                <input
                  type="password"
                  className="input-field"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Leave blank to keep current password"
                />
              </div>
              {/* When editing an admin, keep the UI minimal: only username & password can be modified */}
              {editingUser?.role !== 'admin' && (
                <>
                  <div className="input-group">
                    <label className="text-xs font-semibold text-secondary">Role</label>
                    <select
                      className="input-field"
                      value={editRole}
                      onChange={e => setEditRole(e.target.value)}
                    >
                      <option value="technician">Technician (Configurable Permissions)</option>
                      <option value="admin">Admin (Full access + user management)</option>
                      <option value="viewer">Viewer (Read-Only)</option>
                    </select>
                  </div>

                  <div className="input-group">
                    <label className="text-xs font-semibold text-secondary flex items-center justify-between">
                      <span>Assigned Trade / Specialty</span>
                      <span className="text-2xs text-muted font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      value={editTrade}
                      onChange={e => setEditTrade(e.target.value)}
                      placeholder="e.g. Electrical, HVAC, Plumbing"
                    />
                    <span className="text-2xs text-muted">Craft or department specialty.</span>
                  </div>

                  {/* Role-Specific Permissions Config */}
                  {editRole === 'technician' ? (
                    <div className="p-md rounded-lg flex-column gap-sm" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <div className="flex items-center gap-xs mb-2xs">
                        <Sparkles size={16} color="#3b82f6" />
                        <span className="text-xs font-bold text-foreground">Technician Permissions</span>
                      </div>

                      <label className="flex items-center gap-sm cursor-pointer p-xs rounded hover-bg-subtle">
                        <input
                          type="checkbox"
                          checked={editCanManageItems}
                          onChange={e => setEditCanManageItems(e.target.checked)}
                          style={{ width: '16px', height: '16px' }}
                        />
                        <div>
                          <div className="text-xs font-semibold text-foreground flex items-center gap-xs">
                            <MapPin size={13} className="text-green" />
                            <span>Manage Floorplan Items</span>
                          </div>
                          <div className="text-2xs text-muted">Allow adding and editing rooms, equipment, pins, and calibration points.</div>
                        </div>
                      </label>

                      <label className="flex items-center gap-sm cursor-pointer p-xs rounded hover-bg-subtle">
                        <input
                          type="checkbox"
                          checked={editCanUndoAllAuditLogs}
                          onChange={e => setEditCanUndoAllAuditLogs(e.target.checked)}
                          style={{ width: '16px', height: '16px' }}
                        />
                        <div>
                          <div className="text-xs font-semibold text-foreground flex items-center gap-xs">
                            <RotateCcw size={13} color="#c084fc" />
                            <span>Undo All Audit Records</span>
                          </div>
                          <div className="text-2xs text-muted">Allow undoing actions performed by any user. Otherwise, only own actions can be undone.</div>
                        </div>
                      </label>
                    </div>
                  ) : editRole === 'admin' ? (
                    <div className="p-sm rounded-lg flex items-center gap-sm" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                      <Shield size={16} color="#60a5fa" />
                      <span className="text-xs text-secondary">Admins have all permissions and full user management access enabled by default.</span>
                    </div>
                  ) : (
                    <div className="p-sm rounded-lg flex items-center gap-sm" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <Users size={16} className="text-muted" />
                      <span className="text-xs text-muted">Viewers have read-only access to floorplans, equipment, and public data. All editing and administrative permissions are disabled.</span>
                    </div>
                  )}

                  {/* Account Active Status Toggle */}
                  <div className="input-group">
                    <label className="text-xs font-semibold text-secondary">Account Status</label>
                    <label
                      className={`flex items-center gap-sm p-sm rounded-lg ${editingUser.id === user.id ? 'opacity-60' : 'cursor-pointer hover-bg-subtle'}`}
                      style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
                    >
                      <input
                        type="checkbox"
                        checked={editIsActive}
                        disabled={editingUser.id === user.id}
                        onChange={e => setEditIsActive(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: editingUser.id === user.id ? 'not-allowed' : 'pointer' }}
                      />
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-foreground flex items-center gap-xs">
                          <div className={`badge-dot ${editIsActive ? 'active' : 'inactive'}`} />
                          <span>{editIsActive ? 'Active Account' : 'Inactive Account (Suspended)'}</span>
                        </div>
                        <div className="text-2xs text-muted">
                          {editingUser.id === user.id
                            ? 'You cannot deactivate your currently logged-in account.'
                            : (editIsActive ? 'User can log in and perform permitted actions.' : 'User is blocked from logging in.')}
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              )}

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingUser(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <Check size={14} />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
