var md5 = require('../lib/md5.js');

module.exports = {
    hash: function(text, fn) {
    	salt = Math.floor(Math.random() * 1000000);
        fn(md5(String(text + salt))+':'+salt);
    },

    compareHash: function(password, configPassword, callback) {
    	var data = String(configPassword).split(":");
    	if (md5(password + parseInt(data[1])) === data[0]) {
            callback(1);
    	} else {
    		callback(0);
    	}
    }
};
