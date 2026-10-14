(function (CH) {
  'use strict';

  var listeners = {};
  var ws = null;
  var attempts = 0;
  var reconnectTimer = null;
  var pingTimer = null;
  var closedOnPurpose = false;
  var urlIndex = 0;

  function emit(event, payload) {
    (listeners[event] || []).forEach(function (fn) { fn(payload); });
  }

  function urls() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = location.host;
    return [
      proto + '//' + host + '/ws',
      proto + '//' + host + '/',
      proto + '//' + host
    ];
  }

  function currentUrl() {
    var list = urls();
    return list[urlIndex % list.length];
  }

  function nextUrl() {
    urlIndex = (urlIndex + 1) % urls().length;
    return currentUrl();
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function dropSocket() {
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    } catch (e) { /* ignore */ }
    ws = null;
  }

  function connect(force) {
    closedOnPurpose = false;
    if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimers();
    dropSocket();
    emit('status', { state: attempts === 0 ? 'connecting' : 'reconnect' });
    var url = currentUrl();
    try { ws = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () {
      attempts = 0;
      pingTimer = setInterval(function () { send({ type: 'ping' }); }, 20000);
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
      nextUrl();
      scheduleReconnect();
    };
    ws.onerror = function () { /* onclose переподключит */ };
  }

  function scheduleReconnect() {
    emit('status', { state: 'reconnect' });
    var delay = Math.min(8000, 400 * Math.pow(2, Math.min(attempts, 5)));
    attempts += 1;
    reconnectTimer = setTimeout(function () { connect(true); }, delay);
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function reconnectNow() {
    attempts = 0;
    connect(true);
  }

  function disconnect() {
    closedOnPurpose = true;
    clearTimers();
    dropSocket();
  }

  function on(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
  }

  window.addEventListener('online', function () {
    if (closedOnPurpose) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    attempts = 0;
    connect(true);
  });
  window.addEventListener('offline', function () {
    emit('status', { state: 'offline' });
  });

  function isOpen() { return !!(ws && ws.readyState === WebSocket.OPEN); }

  CH.net = {
    connect: connect,
    reconnectNow: reconnectNow,
    send: send,
    disconnect: disconnect,
    on: on,
    isOpen: isOpen
  };
})(window.CH = window.CH || {});
