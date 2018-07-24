var async = require( 'async' );
var https = require( 'https' );
var pg = require( 'pg' );
var express = require( 'express' );
var bodyParser = require( 'body-parser' );
var _ = require ( 'underscore' );
var Decimal = require('decimal.js');
var LRU = require("lru-cache");
var config = require( './config' );

var app = express();
var jsonParser = bodyParser.json();
var lastRequest = new Date();
var currencies;
var version = config.etherwall_version;
var conString = config.pg_uri;
var cache = LRU(500);

app.use( jsonParser );

app.logger = require( './lib/logger' );
app.logger.initialize( app, 4 );

function getLastBlock( req, client, done ) {
  var sql = 'SELECT number FROM view_blocks b ORDER BY b.number DESC LIMIT 1';
  app.logger.logQuery( 'lastblock', { sql: sql, values: [] } );
  client.query(sql, [], function(err, result) {
    if( err ) {
      return done( err );
    }

    if ( result && result.rows && result.rows.length ) {
      return done( null, result.rows[0].number );
    }

    return done( null, -1 ); // TODO: bigint!
  });
}

function getTransactions( req, client, done ) {
  if ( !req || !req.body || !req.body.accounts || !req.body.accounts.length ) {
    return done( 'Invalid request' );
  }

  if ( req.body.accounts.length > 100 ) {
    return done( 'Too many accounts in request, maximum is 100' );
  }

  var values = [];
  var params = [];

  for ( var i = 0; i < req.body.accounts.length; i++ ) {
    let acc = req.body.accounts[i].toLowerCase();
    if ( acc.startsWith('0x') ) {
      acc = acc.substring(2);
    }
    params.push( `DECODE($${(i + 1)}, 'hex')` );
    values.push( acc );
  }

  var paramStr = params.join(',');
  var sql = 'SELECT hash, blockNumber, blockHash, t.from, t.to, t.value, gas, gasPrice FROM view_transactions t WHERE t.from_raw IN (' + paramStr + ') OR t.to_raw IN (' + paramStr + ')';
  app.logger.logQuery( 'transactions', { sql: sql, values: values } );
  client.query(sql, values, function(err, result) {
    if( err ) {
      return done( err );
    }

    if ( result && result.rows && result.rows.length ) {
      return done( null, _.map(result.rows, function(row) {
        row.blockNumber = new Decimal(row.blocknumber).toHexadecimal();
        delete row.blocknumber;
        row.blockHash = row.blockhash;
        delete row.blockhash;
        row.gasPrice = new Decimal(row.gasprice).toHexadecimal();
        delete row.gasprice;
        row.value = new Decimal(row.value).toHexadecimal();
        row.gas = new Decimal(row.gas).toHexadecimal();

        return row;
      }) );
    }

    return done( null, [] );
  });
}

pg.connect(conString, function(err, client, done) {
  if(err) {
    return console.error( err.message );
  }

  app.nodes = require( './lib/nodes' );
  app.nodes.initialize( app, config.nodes );

  app.get('/api/health', function (req, res) {
    res.send({ success: true });
  });

  app.post('/api/lastblock', function (req, res) {
    var diff = new Date() - lastRequest;
//    if ( diff < 500 ) { // 2x per second
//        return res.status(403).send( { success: false, error: 'Too many request, try again later' } );
//    }
    lastRequest = new Date();
    getLastBlock( req, client, function ( err, result ) {
      if ( err ) {
        app.logger.logError( err );
        return res.status(400).send( { success: false, error: err } );
      }
      res.send({ success: true, result: result });
    } );
  });

  app.post('/api/transactions', function (req, res) {
    var diff = new Date() - lastRequest;
//    if ( diff < 500 ) { // 2x per second
//        return res.status(403).send( { success: false, error: 'Too many request, try again later' } );
//    }
    lastRequest = new Date();
    getTransactions( req, client, function ( err, result ) {
      if ( err ) {
        app.logger.logError( err );
        return res.status(400).send( { success: false, error: err } );
      }
      res.send({ success: true, result: result, version: version });
    } );
  });

  app.post('/api/version', function (req, res) {
    res.send({ success: true, result: version });
  } );

  app.post('/api/init', function (req, res) {
    var nodeCount = app.nodes.count();
    var warning = config.warning;
    if ( nodeCount === 0 ) {
      warning = warning || 'No valid websocket ethereum nodes found';
    }
    res.send({
      success: true,
      warning: warning,
      version: version,
      endpoint: app.nodes.next(),
      nodes: nodeCount
    });
  } );

  app.post('/api/contracts', function( req, res ) {
    if ( !req || !req.body || !req.body.address ) {
      return res.send( { success: false, error: 'Invalid request' } );
    }

    var apiVersion = 'api'; // main

    if ( req.body.testnet ) {
      apiVersion = 'ropsten';
    }

    var data = '';
    var address_lower = req.body.address.toLowerCase();
    if ( address_lower.length != 42 ) {
      return res.send( { success: false, error: 'invalid address' } );
    }

    if ( apiVersion === 'api' && cache.has(address_lower) ) { // cache main only
      console.log( `Found contract ABI on prefix ${apiVersion} in cache` );
      res.send( { success: true, abi: cache.get(address_lower) } );
      return;
    }

    console.log( `Requesting contract ABI on prefix ${apiVersion}` );
    https.get(`https://${apiVersion}.etherscan.io/api?module=contract&action=getabi&address=${address_lower}&apikey=${config.etherscan_key}`,
    function( r ) {
      r.on( 'error', function( err ) {
        console.error( err );
        return res.send( { success: false, error: err } );
      } );

      r.on( 'data', function( d ) {
        data += String(d);
      } );

      r.on( 'end', function() {
        try {
          var json = JSON.parse( data );
          var abi = JSON.parse(json.result);
          if ( apiVersion === 'api' ) {  // cache main only
            cache.set(address_lower, abi);
          }
          res.send( { success: true, abi: abi } );
        } catch ( err ) {
          res.send( { success: false, error: err } );
        }
      } );
    } );
  } );

  app.post('/api/currencies', function( req, res ) {
    var now = new Date().valueOf();
    if ( !currencies || ( now - currencies.date ) > 1000 * 300 ) { // older than 5m
      console.log( 'Requesting prices' );

      var data = '';
      https.get('https://www.cryptocompare.com/api/data/price?fsym=ETH&tsyms=BTC,USD,CAD,EUR,GBP',
      function( r ) {
        r.on( 'error', function( err ) {
          console.error( err );
          return res.send( { success: false, error: err } );
        } );

        r.on( 'data', function( d ) {
          data += String(d);
        } );

        r.on( 'end', function() {
          try {
            currencies = JSON.parse( data );
            currencies.date = new Date().valueOf();
            res.send( { success: true, currencies: currencies } );
          } catch ( err ) {
            res.send( { success: false, error: err } );
          }
        } );
      } );
    } else {
      res.send( { success: true, currencies: currencies } );
    }
  });

  var server = app.listen(3000, 'localhost', function () {
    var host = server.address().address;
    var port = server.address().port;

    app.logger.logInfo('App listening at http://' + host + ':' + port);
  });
} );
