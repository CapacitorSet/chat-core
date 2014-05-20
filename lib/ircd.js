var md5 = require('../lib/md5.js');

module.exports = {
  hash: function(text, fn) {
  	salt = Math.random() * 1000000;
    fn(err, md5(text + salt));
  },

  compareHash: function(password, configPassword, callback) {
  	console.log(password);
  	console.log(configPassword);
  }
};
