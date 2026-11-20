import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { refreshSession } from '../src/refreshSession.js';

test('parallel requests rotate once and the next rotation uses the replacement', async () => {
  const stored = new Map([['token', 'old-access'], ['refresh_token', 'old-refresh']]);
  globalThis.localStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const requests = [];
  let complete;
  axios.defaults.adapter = (config) => {
    requests.push(JSON.parse(config.data));
    return new Promise((resolve) => { complete = (data) => resolve({ data, status: 200, config, headers: {} }); });
  };
  const first = refreshSession('http://test');
  const second = refreshSession('http://test');
  assert.equal(first, second);
  assert.equal(requests.length, 1);
  complete({ access_token: 'new-access', refresh_token: 'new-refresh' });
  await Promise.all([first, second]);
  assert.equal(stored.get('token'), 'new-access');
  const third = refreshSession('http://test');
  assert.deepEqual(requests, [{ refresh_token: 'old-refresh' }, { refresh_token: 'new-refresh' }]);
  complete({ access_token: 'third-access', refresh_token: 'third-refresh' });
  await third;
});

test('an access token alone never causes a refresh request', async () => {
  globalThis.localStorage = { getItem: (key) => key === 'token' ? 'access-only' : null };
  axios.defaults.adapter = () => { throw new Error('must not make an HTTP request'); };
  await assert.rejects(refreshSession('http://test'), /Sign in again/);
});

test('failed rotation clears the pending request so a new login can renew', async () => {
  const stored = new Map([['refresh_token', 'failed-refresh']]);
  globalThis.localStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  axios.defaults.adapter = () => Promise.reject(new Error('synthetic failure'));
  await assert.rejects(refreshSession('http://test'), /synthetic failure/);
  stored.set('refresh_token', 'new-login-refresh');
  axios.defaults.adapter = (config) => {
    assert.deepEqual(JSON.parse(config.data), { refresh_token: 'new-login-refresh' });
    return Promise.resolve({ data: { access_token: 'access', refresh_token: 'rotated' }, status: 200, config, headers: {} });
  };
  await refreshSession('http://test');
  assert.equal(stored.get('refresh_token'), 'rotated');
});

test('pending renewal cannot restore a logged-out session or overwrite a new login', async () => {
  for (const newLogin of [false, true]) {
    const stored = new Map([['token', 'old-access'], ['refresh_token', 'old-refresh']]);
    globalThis.localStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
    let complete;
    axios.defaults.adapter = (config) => new Promise(resolve => {
      complete = () => resolve({ data: { access_token: 'late-access', refresh_token: 'late-refresh' }, status: 200, config, headers: {} });
    });
    const pending = refreshSession('http://test');
    stored.clear();
    if (newLogin) {
      stored.set('token', 'other-account-access');
      stored.set('refresh_token', 'other-account-refresh');
    }
    complete();
    await assert.rejects(pending, error => error.sessionChanged === true);
    assert.equal(stored.get('token'), newLogin ? 'other-account-access' : undefined);
    assert.equal(stored.get('refresh_token'), newLogin ? 'other-account-refresh' : undefined);
  }
});

test('failed pending renewal does not invalidate a new login', async () => {
  const stored = new Map([['refresh_token', 'old-refresh']]);
  globalThis.localStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  let rejectRequest;
  axios.defaults.adapter = () => new Promise((resolve, reject) => { rejectRequest = reject; });
  const pending = refreshSession('http://test');
  stored.set('token', 'new-access');
  stored.set('refresh_token', 'new-refresh');
  rejectRequest(new Error('old renewal failed'));
  await assert.rejects(pending, error => error.sessionChanged === true);
  assert.equal(stored.get('token'), 'new-access');
  assert.equal(stored.get('refresh_token'), 'new-refresh');
});
