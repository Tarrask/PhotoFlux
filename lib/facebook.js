
var request = require('request'),
	debug	= require('debug')("photoflux:fb");
var fbUrl = "https://graph.facebook.com/";

var fbAppId  = process.env.FACEBOOK_APP_ID || 0;
var fbSecret = process.env.FACEBOOK_SECRET || "abcd1234";
var appToken;

module.exports.get = function(token, ids, fields, fn) {
	var url = fbUrl;
	if(Array.isArray(ids))	{ url += "?ids=" + ids.join(',') + "&access_token=" + token; }
	else					{ url += ids + "?access_token=" + token; }
	if(fields) { url += "&fields=" + fields; }
	debug("Requesting facebook", url);
	request.get(url, function(err, response, body) {
		if(err) return fn(err, null);
		if(!body) return fn(new Error("Nothing returned by Facebook"));
		try {
			var data = JSON.parse(body);
			if(data.error) return fn(new Error(data.error.code + " - " + data.error.message), data);
			fn(err, data);
		}
		catch(err) {
			fn(err);
		}
	});
};

module.exports.getPhotos = function(token, ids, fn) {
	this.get(token, ids, "photos.fields(name,source,link,height,width)", function(err, data) {
		if(err) return fn(err);
		debug("facebook return");
		var photos = [];
		for(var key in data) {
			photos = photos.concat(data[key].photos.data);		
		}
		photos.sort(function(a,b) { return a.created_time < b.created_time ? 1 : -1; });
		fn(null, photos);
	});
};

function _requestAppToken(fn) {
	if(appToken) return fn();
	
	var url = fbUrl + "oauth/access_token" +
			"?client_id=" + fbAppId + 
			"&client_secret=" + fbSecret +
            "&grant_type=client_credentials";
	debug("requesting app token", url);
	request.get(url, function(err, response, body) {
		if(err) return fn(err);
		if(body.lastIndexOf("access_token=", 0) === 0) {
			appToken = body.substring("access_token=".length);
			debug("new app token", appToken);
		}
		return fn();
	});
	return fn();
}