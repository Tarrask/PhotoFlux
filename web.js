if(process.env.NODETIME_ACCOUNT_KEY) {
  require('nodetime').profile({
    accountKey: process.env.NODETIME_ACCOUNT_KEY,
    appName: 'My Application Name' // optional
  });
}

var express 	= require('express'),
	app 		= module.exports = express(),
	request		= require('request'),
//	RedisStore	= require('connect-redis')(express),
	util 		= require('util'),
	mu 			= require('mu2'),
	debug 		= require('debug')('photoflux:web'),
	auth 		= require('connect-auth')
	async		= require('async');
	
var	storage 	= require('./lib/storage'),
	fb 			= require('./lib/facebook');

var updateInterval = 5 * 60 * 1000; // min * second * milisecond
var imagesPerPage = 5;
	
// Session configuration
var cookieSecret = process.env.SECRET || "afv932uvrnjqi4rh9";


app.engine('mustache', mu2proxy);// rendu mustache. @see:mu2proxy
app.param('fid', loadFlux);
app.use(express.logger('dev'));
app.use(express.favicon());
//app.use(express.compress());
app.use("/static", express.static(__dirname + '/static/'));
app.use(express.cookieParser());
app.use(express.bodyParser());
app.use(express.session({
	secret: cookieSecret,
//	store: new RedisStore(redisOptions)
}));
app.use(auth({
	strategies: auth.Facebook({
		appId : process.env.FACEBOOK_APP_ID || 0, 
		appSecret: process.env.FACEBOOK_SECRET || "abcd1234", 
		scope: "user_photos,manage_pages", 
//		callback: process.env.FACEBOOK_CALLBACK || "http://photoflux.tarnet.ch/imback"}), 
		// callback doit être ça, car hard-codé dans la strategie facebook
		// TODO: réécrire la strategie, pour être un peu plus modulable.
		callback: process.env.FACEBOOK_CALLBACK || "http://photoflux.tarnet.ch/auth/facebook_callback"}),  
	trace: true}));
app.use(app.router);

///////////////////////////////////////////////////////
// Routes
app.get("/",						render("index.mustache", {title: "PhotoFlux | Page d'accueil"}));
app.get("/letsgo",					function(req, res) { res.render("letsgo.mustache", defaultData(req)); });
app.get("/loginWithFacebook",		fbConnected, loginWithFacebook);
app.get("/albumsSelection",	  		fbConnected, albumsSelectionGet);
app.get("/albumsSelection/:pid",	fbConnected, albumsSelectionGet);
app.post("/albumsSelection",		fbConnected, albumsSelectionPost);
app.post("/albumsSelection/:pid",	fbConnected, albumsSelectionPost);
app.get("/fluxValidation",			fbConnected, validation, renderFlux);
app.get("/fluxValidation/:page",	fbConnected, validation, renderFlux);
app.get("/fluxCreation",			fbConnected, saveFlux);
app.get("/login",					fbConnected, login);
app.get("/logout",					logout);
app.get("/f/:fid",					updateFluxIfNeeded, renderFlux);
app.get("/f/:fid/:page",			renderFlux);
app.get("/confidentiality",			render('confidentiality.mustache'));
app.get("/eula",					render('eula.mustache'));
app.get("/support",					render('support.mustache'));

// development stuff
if(process.env.NODE_ENV == "development") {
	app.get("/test", dummy);
	app.get("/_session", function(req, res) { res.set('Content-Type', "application/json"); res.end(JSON.stringify(req.session, null, 2));});
}

///////////////////////////////////////////////////////
// listen to the PORT given to us in the environment
var port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log("PhotoFlux listening on " + port);
});


///////////////////////////////////////////////////////
// route functions
function loginWithFacebook(req, res, next) {
	var auth = req.getAuthDetails();
	var fid = auth.user.username || auth.user.id;
	var pages, albums;
	
	async.parallel([
	// tente de charger le flux depuis le storage
	function(callback) {
		storage.getFlux(fid, function(err, data) {
			if(err && !data) return callback(err);
			if(data.error) {
				debug("storage return an error", data);
				// une soft erreur, la galerie n'existe juste pas.
				if(data.error === "not_found") {
					return callback();
				}
				// si c'est une autre erreur, on la propage.
				else {
					return callback(new Error(data.error + ": " + data.reason));
				}
			}
			
			// tout va bien, on poursuit la route.
			req.session.flux = data;
			callback();
		});
	},
	// récupère la liste des albums sur facebook
	function(callback) {
		debug("Fetching facebook pages and albums list");
		fb.get(req.session.access_token, auth.user.id, "accounts.fields(id,access_token,link,username,name,albums.fields(name,cover_photo,privacy)),albums.fields(name,cover_photo,privacy)", function(err, data) {
			if(err) return next(err);
			albums = data.albums.data;
			if(data.accounts) {
				pages = data.accounts.data;
				for(var i = 0; i < pages.length; i++) {
					pages[i].pid = pages[i].username || pages[i].id;
				}
			}
			//récupère les images de couvertures
			debug("Fetching cover photos");
			var covers = [];
			for(var i = 0; i < albums.length; i++) {
				covers.push(albums[i].cover_photo);
			}
			fb.get(req.session.access_token, covers, "picture", function(err, data) {
				if(err) return next(err);
				
				for(var i = 0; i < albums.length; i++) {
					var picture = data[albums[i].cover_photo];
					albums[i].cover_photo = picture;
				}
				callback();
			});
		});
	}
	
	], function() {
		// merge les albums fb avec le flux ou crée un nouveau flux
		var flux = req.session.flux = req.session.flux || {};
		
		flux._id  = flux._id || "flux-" + fid;
		flux.type = "flux";
		// merge user
		flux.user = req.session.flux.user || {};
		flux.user.id = auth.user.id;
		flux.user.name = auth.user.name;
		flux.user.link = auth.user.link;
		flux.user.username = auth.user.username;
		flux.user.locale = auth.user.locale;
		flux.user.token = req.session.access_token;
		// merge albums
		flux.albums = flux.albums || [];
		for(var i = 0; i < flux.albums.length; i++) {
			if(flux.albums[i].selected) {
				for(var j = 0; j < albums.length; j++) {
					if(flux.albums[i].id == albums[j].id) {
						albums[j].selected = true;
					}
				}
			}
		}
		flux.albums = albums;
		flux.pages = pages;
			
		// redirect vers albumsSelection
		res.redirect('/albumsSelection');
	});
}

function albumsSelectionGet(req, res, next) {
	var flux = req.session.flux;
		
	// les albums d'une page sont demandés
	if(req.params.pid) {
		debug("albumsSelection for a page");
		var pid = req.params.pid;
		var page;
		for(var i = 0; i < flux.pages.length; i++) {
			if(pid == flux.pages[i].pid) {
				page = flux.pages[i];
			}
		}
		debug("page is", page, page.albums.data);
		
		storage.getFlux(pid, function(err, pageFlux) {
			if(err && !pageFlux) return next(err);
			debug("getFlux just return", pageFlux);
			if(pageFlux.error) {
				debug("storage return an error", pageFlux);
				// une soft erreur, la galerie n'existe juste pas.
				if(pageFlux.error === "not_found") {
					req.session.pageFlux = pageFlux = {};
				}
				// si c'est une autre erreur, on la propage.
				else {
					return next(new Error(pageFlux.error + ": " + pageFlux.reason));
				}
			}
			else {
				req.session.pageFlux = pageFlux;
			}
			
			var albums = page.albums.data;
			
			// merge pageFlux
			pageFlux.type = "flux";
			pageFlux._id = pageFlux._id || "flux-" + pid;
			pageFlux.user = pageFlux.user || {};
			pageFlux.user.id = page.id;
			pageFlux.user.username = page.username;
			pageFlux.user.name = page.name;
			pageFlux.user.link = page.link;
			pageFlux.user.token = page.access_token;
			pageFlux.albums = pageFlux.albums || [];
			debug("mergin pageFlux", pageFlux.albums, albums);
			for(var i = 0; i < pageFlux.albums.length; i++) {
				if(pageFlux.albums[i].selected) {
					for(var j = 0; j < albums.length; j++) {
						if(flux.albums[i].id == albums[j].id) {
							debug("Go here...............................");
							albums[j].selected = true;
						}
					}
				}
			}
			pageFlux.albums = albums;
			
			debug("pageFlux merged", pageFlux);
			
			var covers = [];
			for(var i = 0; i < albums.length; i++) {
				covers.push(albums[i].cover_photo);
			}
			fb.get(page.access_token, covers, "picture", function(err, photos) {
				if(err)	return next(err);
				
				for(var i = 0; i < albums.length; i++) {
					var photo = photos[albums[i].cover_photo];
					albums[i].cover_photo = photo;
				}
				debug("render albums", albums);
				res.render("albumSelection.mustache", defaultData(req, {
					albums: albums
				}));
			});
		});
	}
	else {
		debug("albumsSelection for user album", req.session.flux.pages);
		res.render("albumSelection.mustache", defaultData(req, {
			albums: flux.albums,
			pages: {list: flux.pages}
		}));
	}
}

function albumsSelectionPost(req, res, next) {
	if(!req.body) return next(new Error("Nothing in body"));
	if(typeof req.body !== "object") return next(new Error("Body not an object"));
	if(!req.body.album) return next(new Error("No album in body"));
	
	var flux;
	
	// l'album concerne une page
	if(req.params.pid) {
		var pid = req.params.pid;
		flux = req.session.pageFlux;
	}
	else {
		flux = req.session.flux;
	}
	
	var albums = flux.albums;
	var selectedAlbums = typeof req.body.album === "string" ? [req.body.album] : req.body.album;
	for(var i = 0; i < albums.length; i++) {
		albums[i].selected = (selectedAlbums.indexOf(albums[i].id) > -1);
	}
	
	debug("get facebook photos for selected albums");
	fb.getPhotos(flux.user.token, selectedAlbums, function(err, photos) {
		if(err) return next(err);
		flux.photos = photos;
		flux.lastUpdate = Date.now();
		req.session.flux = flux;
		res.redirect("/fluxValidation");
	});
}

function saveFlux(req, res, next) {
	var flux = req.session.flux;
	var fid = flux.user.username || flux.user.id;
	storage.saveFlux(fid, flux, function(err) {
			if(err) return next(err);
			res.redirect("/f/" + fid);
		});
}

function login(req, res, next) {
	var redir = req.query.redir || req.rootUrl;
	res.redirect(redir);
}

function logout(req, res, next) {
	req.logout(function() {
		req.session.destroy(function(err) {
			if(err) return next(err);
			res.redirect("/");
		});
	});
}

////////////////////////////////////////////////////////
// helper functions

// MiddleWare pour s'assurer que l'utilisateur est connecté à facebook
function fbConnected(req, res, next) {
//	if(req.isAuthenticated()) {
//		next();
//	}
//	else {
		req.authenticate('facebook', function(err, authenticated) {
			if(err) return next(err);
			
			if(authenticated == true) {
				next();
			}
			else if(authenticated == false) {
				res.redirect(req.rootUrl);
			}
			else {}
		});
//	}
}

function validation(req, res, next) {
	req.validate = true;
	next();
}

// Affichage du flux avec gestion du paging
function renderFlux(req, res, next) {
	if(!req.session.flux) return next(new Error("No flux loaded"));
	
	var photos = req.session.flux.photos;
	var ipp = imagesPerPage;
	var page = req.params.page || 1;
	if((page-1)*ipp >= photos.length) return res.send(404); 
	var homeUrl = req.route.path.replace(":fid", req.session.flux._id.substring("flux-".length)).replace("/:page", "") + "/";
	var haveNext = page*ipp < photos.length;
	var data = defaultData(req, {
			photos: photos.slice(ipp*(page-1), ipp*page),
			infiniteScroll: true,
			validate: req.validate,
			pager: {
				current: page,
				prev: page < 2 ? false : homeUrl + (page-1),
				home: homeUrl,
				next: haveNext ? homeUrl + (page+1) : false
			}
		});
	res.render("galerie.mustache", data);
}

function render(template, data) {
	return function(req, res) {
		res.render(template, defaultData(req, data));
	};
}

// Mise-à-jour du flux auprès de facebook, si l'interval de mise-à-jour est passée
function updateFluxIfNeeded(req, res, next) {
	// on passe si aucun flux
	if(!req.session.flux) return next();
	
	// si le flux est à jour, on passe
	var flux = req.session.flux;
	if(flux.lastUpdate && flux.lastUpdate + updateInterval > Date.now()) return next();
	
	// si on a pas de token on passe avec un warning
	if(!flux.user.token) {
		debug("Aucun token disponible pour mettre à jour ce flux.");
		return next();
	}
	
	// mise-à-jour très simple, on remplace seulement les données qu'on a
	// part celles fournies par facebook.
	debug("updating flux");
	var albums = flux.albums;
	var selectedAlbums = [];
	for(var i = 0; i < albums.length; i++) { 
		if(albums[i].selected) { selectedAlbums.push(albums[i].id); }
	}
	fb.getPhotos(flux.user.token, selectedAlbums, function(err, photos) {
		if(err) return next(err);
		flux.photos = photos;
		flux.lastUpdate = Date.now();
		var fid = flux.user.username || flux.user.id;
		storage.saveFlux(fid, flux, function(err) {
			if(err) return next(err);
			return next();
		});
	});
}

// Charge un flux depuis le storage
function loadFlux(req, res, next, fid) {
	debug("loadFlux with fid=" + fid);
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

// Renseigne les données pour mustache communes à toutes les pages.
function defaultData(req, data) {
	console.log(req.headers);
	data = data || {};
	data.staticUrl		= data.staticUrl	|| "/static";
	data.originalUrl	= data.originalUrl	|| req.originalUrl;
	data.user			= data.user 		|| req.getAuthDetails().user;
	data.development	= process.env.NODE_ENV == 'development';
	data.title			= data.title		|| "PhotoFlux | " + req.url.substring(1);
	return data;
}

// On utilise mu2 https://github.com/raycmorgan/Mu plutôt que
// mustache disponible avec consolidate. mustache ne semble
// pas gérer le chargement automatique des parials.
function mu2proxy(path, options, callback) {
	mu.root = 'views';
	// bric-à-brac pour gérer mon pseudo proxy
	if(app.get('views') == "../PhotoFlux/views/") {
		mu.root = app.get('views');
		path = path.substr(mu.root.length);
	}

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
	res.send('<html><body><h1>Dummy page</h1><p>'+req.headers.host+req.originalUrl+'</p><h3>params</h3><pre>'+util.inspect(req.params)+'</pre><h3>session</h3><pre>'+util.inspect(req.session)+'</pre></body></html>');
}