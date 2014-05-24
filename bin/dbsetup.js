var winston = require('winston'),
    sequelize = require('../lib/sequelize'),
    models = require('../lib/models');

sequelize
  .sync({ force: true })
  .complete(function(err) {
     if (!!err) {
       console.log('An error occurred while creating the table:', err)
     } else {
       console.log('It worked!')
     }
  })
