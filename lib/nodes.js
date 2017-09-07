module.exports = ( function () {
  var _ = require('underscore');
  var WebSocket = require('ws');
  var nodes = {};
  var active = [];
  var app;
  var maxBlock = 0;
  var payload = '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":99999}';

  function random(min, max) {
      return Math.floor(Math.random() * (max - min)) + min;
  }

  function invalidateNode(node) {
    for (var i = 0; i < active.length; i++) {
      if (active[i] === node.endpoint) {
        active = active.splice(i, 1);
      }
    }
  }

  function validateNode(node) {
    app.logger.logInfo(node.endpoint + ' block ' + node.block + ' checked ' + node.lastCheck);
    if (active.indexOf(node.endpoint) < 0) {
      active.push(node.endpoint);
    }
  }

  function createWebsocket(node) {
    var ws = new WebSocket(node.endpoint, {
      origin: 'http://localhost'
    });

    ws.on('error', function(err) {
      app.logger.logError(node.endpoint + ': ' + err);
      invalidateNode(node);
    });

    ws.on('open', function() {
      ws.send(payload);
    });

    ws.on('message', function(msg) {
      var response = JSON.parse(msg);
      if (response.id != 99999) {
        return app.logger.logError('Invalid response id from node: ' + node.endpoint);
      }

      if (!response.result) {
        return app.logger.logError('Invalid response block number from node: ' + node.endpoint);
      }

      node.block = parseInt(response.result);
      node.lastCheck = new Date().valueOf();
      if (node.block > maxBlock) {
        maxBlock = node.block;
        validateNode(node);
      } else if (node.block < maxBlock - 24) { // 2m worth of blocks at most
        invalidateNode(node);
      } else {
        validateNode(node);
      }

      ws.close();
    });

    return ws;
  }

  function initialize(_app, endpoints) {
    app = _app;

    _.each(endpoints, function(endpoint) {
      var node = {
        block: 0,
        lastCheck: 0,
        endpoint: endpoint
      };

      node.ws = createWebsocket(node);
      nodes[endpoint] = node;
    });

    setInterval(checkNodes, 60000);
  }

  function next() {
    return active[random(0, active.length)];
  }

  function check(node) {
    app.logger.logInfo('Checking ' + node.endpoint);
  }

  function checkNode(node) {
    node.ws = createWebsocket(node);
  }

  function checkNodes() {
    app.logger.logInfo('Active endpoints: ' + active);
    _.each(nodes, checkNode);
  }

  function count() {
    return active.length;
  }

  return {
    initialize: initialize,
    next: next,
    count: count
  };
}());
