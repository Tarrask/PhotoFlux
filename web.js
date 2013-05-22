
var express = require('express'),
	app = module.exports = express(),
	request = require('request'),
	RedisStore = require('connect-redis')(express),
	util = require('util'),
	storage = require('./lib/storage'),
	mu = require('mu2'),
	debug = require('debug')('photoflux:web');

// Session configuration
var cookieSecret = process.env.SECRET || "afv932uvrnjqi4rh9";

app.engine('mustache', _mu2proxy);// rendu mustache. @see:_mu2proxy
app.use(express.logger('dev'));
app.use(express.favicon());
app.use(express.cookieParser());
app.use(express.session({
	secret: cookieSecret,
//	store: new RedisStore(redisOptions)
}));

app.param('fid', loadFlux('fid'));
app.param('uid', loadFlux('uid'));
app.param('pid', loadFlux('pid'));

app.get("/", function(req, res) { res.send("photoFlux vhost running"); });
app.get("/test", dummy);
if(process.env.NODE_ENV == "development") {
	app.get("/_session", function(req, res) { res.end(JSON.stringify(req.session, null, 2));});
}
app.get("/test/:fid", dummy);
app.get("/f/:fid", dummy);
app.get("/p/:pid", dummy);
app.get("/u/:uid", dummy);

// listen to the PORT given to us in the environment
var port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log("PhotoFlux listening on " + port);
});

////////////////////////////////////////////////////////
// helper functions
function loadFlux(type) {
	return function(req, res, next, fid) {
		debug("loadFlux " + type, fid);
		
		// si le flux de la session est déjà le bon, passe à la suite.
		if(req.session.flux && req.session.flux._id == "flux-"+fid) {
			debug("flux ok, next");
			return next();
		}
		
		// sinon, on charge le flux depuis la base de donnée et le stock dans la session
		storage.getFlux(fid, function(err, data) {
			debug("storage return");
			if(err && !data) return next(err);
			if(data.error) {
				debug("storage return an error", data);
				// une soft erreur, la galerie n'existe juste pas.
				if(data.error === "not_found") {
					return res.render("fluxNotFound.mustache");
				}
				// si c'est une autre erreur, on la propage.
				else {
					return next(new Error(data.error + ": " + data.reason));
				}
			}
			
			// tout va bien, on poursuit la route.
			req.session.flux = data;
			return next();
		});
		
	}
}

// On utilise mu2 https://github.com/raycmorgan/Mu plutôt que
// mustache disponible avec consolidate. mustache ne semble
// pas gérer le chargement automatique des parials.
function _mu2proxy(path, options, callback) {
	
	// on recompile les templates à chaque fois durant le development
	if (app.get('env') == 'development') {
		debug("clearing mustache cache");
		mu.clearCache();
	}
	
	var stream = mu.compileAndRender(path, options);
	var html = "";
	stream.on('data', function(data) {
		html += data;
	});
	stream.on('end', function() {
		callback(null, html);
	});
	stream.on('error', function(err) {
		callback(err, null);
	});
}

function dummy(req, res) {
	res.set('Content_type', 'text/html');
	res.send('<html><body><h1>Dummy page</h1><p>'+req.headers.host+req.originalUrl+'</p><pre>'+util.inspect(req.params)+'</pre><pre>'+util.inspect(req.session)+'</pre></body></html>');
}