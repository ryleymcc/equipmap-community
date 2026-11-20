import axios from 'axios';

let inFlight = null;

// All requests in this browser share one rotation. Parallel refreshes would
// reuse the same credential and correctly trigger the server's replay defense.
export function refreshSession(baseUrl) {
  if (inFlight) return inFlight;
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return Promise.reject(new Error('Sign in again to renew this session'));

  inFlight = axios.post(`${baseUrl}/api/refresh-token`, { refresh_token: refreshToken })
    .then(({ data }) => {
      if (localStorage.getItem('refresh_token') !== refreshToken) {
        const error = new Error('Session changed while renewal was pending');
        error.sessionChanged = true;
        throw error;
      }
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      return data;
    })
    .catch((error) => {
      if (localStorage.getItem('refresh_token') !== refreshToken) {
        error.sessionChanged = true;
      }
      throw error;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
