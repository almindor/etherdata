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
      if (active[i].endpoint === node.endpoint) {
        active.splice(i, 1);
      }
    }
  }

  function nodeAlias(node) {
    return node.alias || node.endpoint
  }

  function validateNode(node) {
    var now = new Date().valueOf();

    app.logger.logInfo(nodeAlias(node) + ' checked');
    if (active.indexOf(node.endpoint) < 0) {
      active.push(node);
    }
    active.sort(function(a, b) {
      return a.priority - b.priority
    })
  }

  function createWebsocket(node, handler) {
    var ws = new WebSocket(node.endpoint, {
      origin: 'http://localhost',
      handshakeTimeout: 5000
    });

    ws.on('error', function(err) {
      app.logger.logError(node.endpoint + ': ' + err);
      invalidateNode(node);
    });

    ws.on('open', function() {
      ws.send(payload);
    });

    ws.on('message', function(msg) {
      handler(node, msg);

      ws.close();
    });

    return ws;
  }

  function initialize(_app, nodes_info) {
    app = _app;

    _.each(nodes_info, function(node_info) {
      var node = {
        block: 0,
        lastCheck: 0,
        endpoint: node_info.endpoint,
        priority: node_info.priority,
        alias: node_info.alias,
      };

      node.ws = createWebsocket(node, onBlockNumber);
      nodes[node.endpoint] = node;
    });

    setInterval(checkNodes, 60000);
  }

  function onBlockNumber(node, msg) {
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
  }

  function next() {
    return active[0].endpoint;
  }

  function check(node) {
    app.logger.logInfo('Checking ' + node.endpoint);
  }

  function checkNode(node) {
    node.ws = createWebsocket(node, onBlockNumber);
  }

  function checkNodes() {    
    _.each(nodes, checkNode);
    app.logger.logInfo('Max block ' + maxBlock + ' endpoint: ' + next() + ' active nodes:');
    _.each(active, function(node) {
      app.logger.logInfo('\t' + nodeAlias(node) + ' - ' + node.block);
    })

    app.logger.logInfo('All nodes:')
    for (var e in nodes) {
      var node = nodes[e];
      app.logger.logInfo('\t' + nodeAlias(node) + ' - ' + node.block);
    }
  }

  function count() {
    return active.length;
  }

  function age() {
    return null;
  }

  return {
    initialize: initialize,
    next: next,
    count: count,
    age: age,
  };
}());
