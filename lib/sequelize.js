var Sequelize = require('sequelize');

var sequelize = new Sequelize('Messaging', 'root', '', {
      dialect: "mysql",
      port:    3306
    });

sequelize
  .authenticate()
  .complete(function(err) {
    if (!!err) {
      console.log('Unable to connect to the database:', err)
    } else {
      console.log('Connection has been established successfully.')
    }
  })

  module.exports = sequelize;