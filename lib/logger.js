module.exports = ( function () {

  /*
   * Simple logging wrapper with loglevels for output
   * Log levels:
   *     0 -- none
   *     1 -- errors only
   *     2 -- errors and info
   *     3 -- all except queries (errors, info, debug)
   *     4 -- all including queries
   */

  var defaultLogLevel = 3;
  var _logLevel = defaultLogLevel;
  var _app;
  var _req;

  function initialize( app, logLevel ) {
    if ( logLevel === undefined ) logLevel = defaultLogLevel;

    _app = app;
    _logLevel = logLevel;
  }

  function setLogLevel( level ) {
    _logLevel = level;
  }

  function getNow() {
    var d = new Date();
    return d.toISOString() + '\t';
  }

  function log( logFunc, level, args, noTime ) {
    if ( _logLevel >= level ) {
      if ( !noTime ) {
        args[0] = getNow() + args[0];
      }
      logFunc.apply(console, args);

      var tmp = [];
      for ( var prop in args ) {
        tmp.push(args[prop]);
      }
    }
  }

  function logIntoDB( args, severity, name ) {
    // TODO
  }

  function logDebug() {
    logIntoDB( arguments, 3 );
    log( console.log, 3, arguments );
  }

  function logInfo() {
    logIntoDB( arguments, 2 );
    log( console.log, 2, arguments );
  }

  function logError() {
    logIntoDB( arguments, 1 );
    log( console.error, 1, arguments );
  }

  function convertValue(v, internal) {
    if ( v instanceof Date && !isNaN(v.valueOf()) ) { // date, convert + quote
      return "'" + v.toUTCString() + "'";
    } else if ( v instanceof Array ) { // array, convert
      var result = internal ? "{" : "'{";
      if ( !internal ) {
        for ( var i = 0; i < v.length; i++ ) {
          result += convertValue(v[i], true);
          if ( i < v.length - 1 ) result += ',';
        }
      } else {
        result += v.join(',');
      }
      result += ( internal ? "}" : "}'" );
      return result;
    } else if ( isNaN(v) ) { // not a number, quote
      if ( internal ) {
        return '"' + v + '"'; 
      }
      return "'" + v + "'";
    }

    return v;
  }

  function logQuery(name, query) {
    if ( !query ) return;

    var nameSep = '=====================[' + name + ']=======================\n';
    var endSep  = '\n=====================/' + name + '/=======================\n';
    var body;
    if ( query._conditions ) { // mongo query
      body = _app.util.inspect(query._conditions, { showHidden: false, depth: 10 });
    } else if ( query.sql ) { // sql query
      //log( console.log, 4, [query.sql, query.values], true);
      body = query.sql;
      if ( query.values && query.values.length ) {
        for ( var i = query.values.length - 1; i >= 0; i-- ) {
          var v = query.values[i];
          v = convertValue(v);
          //var pattern = new RegExp(('\\$' + (i + 1)),["g"]);
          //body = body.replace(pattern, v);
          //log( console.log, 4, ['Replacing $' + (i + 1) + ' with: ' + v]);
          var re = new RegExp('\\$' + (i + 1), 'g');
          body = body.replace(re, v);
        }
      }
    }
    logIntoDB( [body], 4, name );
    log( console.log, 4, [nameSep, body, endSep], true );
  }

  function initLogRequest( req, res, next ) {
    _req = req;

    next();
  }

  return {
    initialize: initialize,
    logDebug: logDebug,
    logInfo: logInfo,
    logError: logError,
    logQuery: logQuery,
    setLogLevel: setLogLevel,
    initLogRequest: initLogRequest
  };

}());
