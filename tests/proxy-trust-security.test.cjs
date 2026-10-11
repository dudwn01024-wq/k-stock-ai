'use strict';
require('./helpers/local-only.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const express = require('express');
const proxyaddr = createRequire(require.resolve('express/package.json'))('proxy-addr');

// Synthetic addresses only; no listener, provider, environment or API is used.
const request = (peer = '203.0.113.9', forwarded = '10.9.8.7') => ({
  socket: {remoteAddress: peer},
  headers: {'x-forwarded-for': forwarded}
});

for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
  test('CVE-2026-90711: ' + subnet + ' cannot trust an arbitrary IPv4 peer', () => {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('203.0.113.9'), false);
    assert.equal(proxyaddr(request(), trust), '203.0.113.9');
    assert.deepEqual(proxyaddr.all(request(), trust), ['203.0.113.9']);
  });
}

test('valid IPv4 and mapped IPv6 trust subnets retain proxy chain behavior', () => {
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('10.1.2.3'), true);
    assert.equal(trust('203.0.113.9'), false);
    assert.equal(proxyaddr(request('10.1.2.3', '198.51.100.8'), trust), '198.51.100.8');
    assert.equal(proxyaddr(request(), trust), '203.0.113.9');
  }
});

test('native IPv6 trust still works without treating IPv4 peers as IPv6', () => {
  const trust = proxyaddr.compile('2001:db8::/32');
  assert.equal(trust('2001:db8::1'), true);
  assert.equal(trust('203.0.113.9'), false);
});

test('Express default proxy policy ignores a forged forwarding header', () => {
  const app = express();
  const req = Object.assign(Object.create(express.request), request(), {app});
  assert.equal(app.get('trust proxy'), false);
  assert.equal(req.ip, '203.0.113.9');
  assert.deepEqual(req.ips, []);
});
