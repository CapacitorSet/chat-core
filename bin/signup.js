var http = require('http'),
	sequelize = require('../lib/sequelize'),
	md5 = require('../lib/md5')
	qs = require('querystring'),

	pubkey    = '6LddovQSAAAAAKBR27JXnpZJYXMLJI7JsHzm0p1V',
	privkey   = '6LddovQSAAAAAGU9JLWXFsmAGMEsPmgNUsSkP-bR',
	addr      = '192.168.1.141',
	port      = 7761, // 0x77 0x61 = "wa" :3
	server = http.createServer(function (req, res) {
		if (req.method === 'GET') {
			res.writeHead(200, {'Content-Type': 'text/html'});
			var html = '<form action="" method="post">Username: <input type="text" name="username" required /><br>Password: <input type="password" name="password" required /><br><script type="text/javascript" src="http://www.google.com/recaptcha/api/challenge?k=' + pubkey + '"></script><noscript><iframe src="http://www.google.com/recaptcha/api/noscript?k=' + pubkey + '" height="300" width="500" frameborder="0"></iframe><br><textarea name="recaptcha_challenge_field" rows="3" cols="40"></textarea><input type="hidden" name="recaptcha_response_field" value="manual_challenge"></noscript><input type="submit" value="Sign up">';
			// HTML from https://developers.google.com/recaptcha/docs/display#AJAX, minified
			res.end(html);
		} else if (req.method === 'POST') {
			var body = '';
			req.on('data', function (data) {
				body += data;
        		if (body.length > 1e5) { // If the client sent more than 100 KB of data
	        		// Discard the data and kill the connection
        			body = null;
        			req.connection.destroy();
        		}
        	});
			req.on('end', function() {
				var data = qs.parse(body),
					msg = 'ok';

				check(privkey, req.ip, data.recaptcha_challenge_field, data.recaptcha_response_field, function(err) {
					if (err) {
						res.end(err);
					} else {
						signup(data.username, data.password, res);
					}
				});
			})
		} else {
			req.end();
		}
	});
	
server.listen(port, addr);
console.log('Server running at http://' + addr + ':' + port + '/');

function check(privateKey, remoteIP, challenge, response, cb) {
	var request = http.request({
		host: 'www.google.com',
		port: 80,
		path: '/recaptcha/api/verify',
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	}, function(response) {
		var body = '';

		response.on('error', function(err) {
			return cb(err);
		});

		response.on('data', function(chunk) {
			body += chunk;
		});

		response.on('end', function() {
			var success = (body.split('\n')[0] === "true"),
			error = body.split('\n')[1];
			if (!success) return cb(error);
			cb(null);
		});

	});

	request.on('error', function(err) {
		return cb(err);
	});

	var query = 'privatekey=' + privateKey + '&remoteip=' + remoteIP + '&challenge=' + challenge + '&response=' + response;
	request.write(query);

	request.end();
};

function signup(theUser, thePass, theRes) {
	/* Looks for users with the given username and password.
	If no such users are found, the user is signed up, and the
	request is terminated with "0". Else, it is terminated
	with "1". */
	var user = theUser,
		pass = thePass,
		res = theRes;

	sequelize.models.User.find({
		where: { username: user }
	}).success(function(item) {
		if (item) {
			// If the user already exists
			res.end('0');
			return;
		}
		var salt = makeSalt(16);
		sequelize.models.User.create({
			username: user,
			password: md5(pass + salt),
			salt: salt
		}).success(function() {
			res.end('1');
		}).error(function() {
			res.end('Invalid data. Username must be an alphanumeric string, at most 32 characters long.');
		});
	})
}

function makeSalt(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for( var i=0; i < length; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
