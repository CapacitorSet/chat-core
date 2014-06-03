var md5 = require('../lib/md5.js');

module.exports = {
    hash: function(text, fn) {
    	salt = Math.floor(Math.random() * 1000000);
        fn(md5(String(text + salt))+':'+salt);
    },

    compareHash: function(password, salt, hash, callback) {
        // In order: password to be checked, salt, hash of (correct password + salt)
    	if (md5(password + salt) === hash) {
            callback(1);
    	} else {
    		callback(0);
    	}
    }
};
