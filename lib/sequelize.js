var Sequelize = require('sequelize'),
    colog = require('colog'),
    config = JSON.parse(require('fs').readFileSync('config/config.json').toString());

var sequelize = new Sequelize(config.database.database, config.database.user, config.database.password, {
        host: config.database.address,
        dialect: config.database.dialect,
        port: config.database.port
    });

colog.info('Connecting to the database...')

sequelize
  .authenticate()
  .complete(function(err) {
    if (err) {
        colog.error('Unable to connect!');
        colog.dump(err, ['red', 'bold']);
    } else {
      colog.success('Connected.')
    }
  })

  module.exports = sequelize;
  module.exports.models = require('./models');
