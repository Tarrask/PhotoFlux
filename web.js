
var express = require('express'),
	app = module.exports = express(),
	request = require('request');

app.use(express.logger());


app.get("/", function(req, res) {
	res.end("photoFlux vhost running");
});

app.get("/test", dummy);

// listen to the PORT given to us in the environment
var port = process.env.PORT || 3000;

app.listen(port, function() {
  console.log("PhotoFlux listening on " + port);
});


////////////////////////////////////////////////////////
// helper function
function dummy(req, res) {
	res.send('<html><body><h1>Dummy page</h1><p>'+req.headers.host+req.originalUrl+'</p></body></html>');
	res.end();
}