import * as Sentry from '@sentry/react';

/**
 * Metric helper to track user button and interaction counts
 */
export const trackButtonClick = (buttonName, tags = {}) => {
  try {
    Sentry.metrics.count('button_click', 1, {
      tags: { button: buttonName, ...tags },
    });
  } catch (e) {
    // Non-fatal
  }
};

/**
 * Metric helper to track point-in-time page load and render times
 */
export const trackPageLoadTime = (pageName, durationMs, tags = {}) => {
  try {
    if (typeof durationMs === 'number' && !isNaN(durationMs)) {
      Sentry.metrics.gauge('page_load_time', durationMs, {
        unit: 'millisecond',
        tags: { page: pageName, ...tags },
      });
    }
  } catch (e) {
    // Non-fatal
  }
};

/**
 * Metric helper to record API response time distribution percentiles
 */
export const trackResponseTime = (endpoint, durationMs, tags = {}) => {
  try {
    if (typeof durationMs === 'number' && !isNaN(durationMs)) {
      Sentry.metrics.distribution('response_time', durationMs, {
        unit: 'millisecond',
        tags: { endpoint, ...tags },
      });
    }
  } catch (e) {
    // Non-fatal
  }
};

export default {
  trackButtonClick,
  trackPageLoadTime,
  trackResponseTime,
};
