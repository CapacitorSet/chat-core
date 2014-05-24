var Sequelize = require('sequelize'),
sequelize = require('./sequelize');

module.exports.Message = sequelize.define('Message', {
	cID: { type: Sequelize.INTEGER, allowNull: false, unique: true },
	to: { type: Sequelize.STRING(16), allowNull: false },
	body: { type: Sequelize.TEXT, allowNull: false }
}, { 
	createdAt: 'timestamp',
	updatedAt: false
});