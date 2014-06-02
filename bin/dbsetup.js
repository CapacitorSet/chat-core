var sequelize = require('../lib/sequelize'),
	colog = require('colog');

sequelize
  .sync({ force: true })
  .complete(function(err) {
     if (!!err) {
       colog.error('An error occurred while creating the table:', err)
     } else {
       colog.success('Tables set up correctly!')
     }
  })
