import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Lock, User, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { getErrorMessage } from '../api';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from || { pathname: "/" };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const user = await login(username, password);

      const requiredRole = location.state?.requiredRole;
      const isAdmin = Boolean(user && (user.role === 'admin' || user.is_admin));
      const isEditor = Boolean(isAdmin || (user && (user.can_manage_items !== false || user.role === 'editor')));

      let hasPermission = true;
      if (requiredRole === 'admin' && !isAdmin) hasPermission = false;
      if (requiredRole === 'editor' && !isEditor) hasPermission = false;

      if (!hasPermission) {
        // If they logged in but still don't have permission for the intended page,
        // return them to where they were BEFORE they clicked the protected link.
        const backTo = location.state?.originalFrom || { pathname: "/" };
        const backToPath = (backTo.pathname || "/") + (backTo.search || "");

        alert(`Your account (${user.role}) does not have permission to access that page.`);
        navigate(backToPath, { replace: true });
      } else {
        // Pass the captured state back to the destination
        navigate((from.pathname || "/") + (from.search || ""), {
          replace: true,
          state: {
            ...location.state, // Pass through dashboardState or mapState
            restoreState: true
          }
        });
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid username or password'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Lock size={32} />
          </div>
          <h1>Sign In</h1>
          <p>Sign in to edit floorplan data</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <label htmlFor="username">Username</label>
            <div className="input-with-icon">
              <User size={18} className="input-icon" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className="input-with-icon">
              <Lock size={18} className="input-icon" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                className="input-password"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <button onClick={() => navigate('/')} className="back-link">
            Continue as Viewer
          </button>
          <button onClick={() => window.open('https://ryleymcc.github.io/equipmap-promo/', '_blank')} className="back-link secondary">
            Learn more about our features
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
