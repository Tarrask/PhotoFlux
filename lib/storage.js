
var request = require('request'),
	debug = require('debug')('photoflux:storage');

var dbType = process.env.STORAGE_TYPE || "couchdb";
var dbUrl  = process.env.STORAGE_URL || "http://127.0.0.1:5984/";

var storage = module.exports = {}

storage.getFlux = function(fid, fn) {
	return this.get('flux', 'flux-'+fid, fn);
}


storage.get = function(database, id, fn) {
	var url = dbUrl;
	url += database + "/";
	url += id;
	debug("dbquery url", url);
	request.get(url, function(err, response, body) {
		if(err) return fn(err, null);
		try {
			var data = JSON.parse(body);
			if(data.error) {
				debug("error returned by db", data);
				return fn(new Error(data.error + ": " + data.reason), data);
			}
			fn(err, data);
		}
		catch(err) {
			return fn(err, null);
		}
	});
};