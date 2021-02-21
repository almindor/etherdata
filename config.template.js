// config vars

module.exports = {
  pg_uri: 'postgres://localhost',
  etherscan_key: 'apikey',
  etherwall_version: '2.0.2',
  nodes: [
    { endpoint: 'wss://node.at', priority: 0, alias: 'node' }
  ]
}
