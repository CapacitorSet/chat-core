var sequelize = require('./lib/sequelize'),
    models = require('./lib/models');

var msg = models.Message.build({
  cID: '12',
  to: '0123456789abcdef',
  body: 'yo'
})
 
msg.save()
   .complete(function(err) {
     if (!!err) {
       console.log('The instance has not been saved:', err)
     } else {
       console.log('We have a persisted instance now')
     }
  })
