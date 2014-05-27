var Sequelize = require('sequelize'),
sequelize = require('./sequelize');

module.exports.Message = sequelize.define('Message', {
	cID: {
		type: Sequelize.STRING(32),
		allowNull: false,
		unique: true,
		validate: {
			is: ["^[a-z|0-9|\+|\/|\=]+$",'i'],     // Base64
			notNull: true,
			notEmpty: true
		}
	},
	to: {
		type: Sequelize.STRING(16),
		allowNull: false
	},
	body: {
		type: Sequelize.TEXT,
		allowNull: false
	}
}, { 
	createdAt: 'timestamp',
	updatedAt: false
});