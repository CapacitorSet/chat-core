var Sequelize = require('sequelize'),
    colog = require('colog');

// For increased speed, credentials for the database are wirtten directly in this file.

var sequelize = new Sequelize('Messaging', 'root', '', {
      dialect: "mysql",
      port:    3306
    });

sequelize
  .authenticate()
  .complete(function(err) {
    if (err) {
      colog.error('Unable to connect to the database:', err)
    } else {
      colog.success('Connected to the database.')
    }
  })

  module.exports = sequelize;
  module.exports.models = require('./models');