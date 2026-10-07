import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Lock, User, AlertCircle, X, LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { getErrorMessage } from '../api';

export default function LoginModal({ isOpen, onClose, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const usernameInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    // Focus username input on open
    const timer = setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please enter both username and password');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const loggedInUser = await login(username.trim(), password);
      const isAdm = loggedInUser.role === 'admin' || loggedInUser.is_admin;
      const isTech = loggedInUser.role === 'technician' || (!isAdm && loggedInUser.role === 'editor');
      if (isTech) {
        localStorage.setItem('wo_filter_tech', loggedInUser.username);
        localStorage.setItem('wo_filter_status', 'open');
      } else if (isAdm) {
        localStorage.setItem('wo_filter_tech', 'Unassigned');
        localStorage.setItem('wo_filter_status', 'all');
      }
      if (onSuccess) {
        onSuccess(loggedInUser);
      }
      onClose();
    } catch (err) {
      console.error('Login error:', err);
      setError(getErrorMessage(err, 'Invalid username or password'));
    } finally {
      setIsLoading(false);
    }
  };

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-card modal-sm glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-card-header">
          <div className="flex items-center gap-sm">
            <div className="icon-box-primary">
              <Lock size={18} />
            </div>
            <div>
              <h3 className="m-0 text-base font-bold text-primary">Sign In</h3>
              <p className="m-0 text-xs text-muted">Access maintenance & work orders</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="modal-card-body">
          {/* Error alert */}
          {error && (
            <div className="alert-box-danger flex items-center gap-xs p-sm text-xs rounded-md">
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <label className="text-xs font-semibold text-secondary mb-xs" htmlFor="modal-username">
              Username
            </label>
            <div className="input-with-icon" style={{ position: 'relative' }}>
              <User size={16} className="text-muted" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                ref={usernameInputRef}
                id="modal-username"
                type="text"
                className="input-field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                required
                style={{ paddingLeft: '36px' }}
              />
            </div>
          </div>

          <div className="input-group">
            <label className="text-xs font-semibold text-secondary mb-xs" htmlFor="modal-password">
              Password
            </label>
            <div className="input-with-icon" style={{ position: 'relative' }}>
              <Lock size={16} className="text-muted" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                id="modal-password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
                style={{ paddingLeft: '36px', paddingRight: '36px' }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="modal-card-footer mt-md">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm gap-xs"
              disabled={isLoading}
            >
              {isLoading ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <LogIn size={14} />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
