(function (CH) {
  'use strict';

  var listeners = {};
  var ws = null;
  var attempts = 0;
  var reconnectTimer = null;
  var pingTimer = null;
  var closedOnPurpose = false;
  var lastUrl = null;

  function emit(event, payload) {
    (listeners[event] || []).forEach(function (fn) { fn(payload); });
  }

  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function connect(url) {
    lastUrl = url || lastUrl || wsUrl();
    closedOnPurpose = false;
    clearTimers();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      emit('status', { state: 'offline' });
      return;
    }
    emit('status', { state: attempts === 0 ? 'connecting' : 'reconnect' });
    try { ws = new WebSocket(lastUrl); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () {
      attempts = 0;
      pingTimer = setInterval(function () { send({ type: 'ping' }); }, 15000);
      emit('status', { state: 'online' });
      emit('open');
    };
    ws.onmessage = function (ev) {
      try { emit('message', JSON.parse(ev.data)); } catch (e) { /* ignore */ }
    };
    ws.onclose = function () {
      clearTimers();
      ws = null;
      if (closedOnPurpose) { emit('status', { state: 'offline' }); return; }
      scheduleReconnect();
    };
    ws.onerror = function () { if (ws) ws.close(); };
  }

  function scheduleReconnect() {
    emit('status', { state: 'reconnect' });
    var delay = Math.min(10000, 500 * Math.pow(2, attempts));
    attempts += 1;
    reconnectTimer = setTimeout(function () { connect(lastUrl); }, delay);
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function disconnect() {
    closedOnPurpose = true;
    clearTimers();
    if (ws) { ws.close(); ws = null; }
  }

  function on(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
  }

  window.addEventListener('online', function () {
    if (!isOpen() && !closedOnPurpose) { attempts = 0; connect(lastUrl); }
  });
  window.addEventListener('offline', function () {
    emit('status', { state: 'offline' });
    if (ws) ws.close();
  });

  function isOpen() { return !!(ws && ws.readyState === WebSocket.OPEN); }

  CH.net = { connect: connect, send: send, disconnect: disconnect, on: on, isOpen: isOpen };
})(window.CH = window.CH || {});
