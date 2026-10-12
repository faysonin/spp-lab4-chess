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
    return proto + '//' + location.host + '/ws';
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function connect(url) {
    lastUrl = url || lastUrl || wsUrl();
    closedOnPurpose = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimers();
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch (e) { /* ignore */ }
      ws = null;
    }
    emit('status', { state: attempts === 0 ? 'connecting' : 'reconnect' });
    try { ws = new WebSocket(lastUrl); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () {
      attempts = 0;
      pingTimer = setInterval(function () { send({ type: 'ping' }); }, 8000);
      send({ type: 'ping' });
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
    ws.onerror = function () { /* onclose сам переподключит; close() здесь давал цикл */ };
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
    if (closedOnPurpose) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    attempts = 0;
    connect(lastUrl);
  });
  window.addEventListener('offline', function () {
    emit('status', { state: 'offline' });
  });

  function isOpen() { return !!(ws && ws.readyState === WebSocket.OPEN); }

  CH.net = { connect: connect, send: send, disconnect: disconnect, on: on, isOpen: isOpen };
})(window.CH = window.CH || {});
