var Sequelize = require('sequelize'),
sequelize = require('./sequelize');

module.exports.Message = sequelize.define('Message', {
	to: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			is: ["^[#|&]?[a-z|0-9|\+|\/|\=]+$",'i'],     // Base64
			notNull: true,
			notEmpty: true
		}
	},
	timestamp: {
		type: Sequelize.BIGINT.UNSIGNED,
		defaultValue: new Date().getTime()
	},
	body: {
		type: Sequelize.TEXT,
		allowNull: false
	}
}, { 
	timestamps: false
});

module.exports.ConvoUserPair = sequelize.define('ConvoUserPair', {
		convo: {
			type: Sequelize.STRING(32),
			allowNull: false,
			validate: {
				is: ["^[#|&][a-z|0-9|\+|\/|\=]+",'i'],
				notNull: true,
				notEmpty: true
			},
			unique: "pair"
		},
		user: {
			type: Sequelize.STRING(32),
			allowNull: false,
			validate: {
				is: ["^[a-z|0-9|\+|\/|\=]+$",'i'],
				notNull: true,
				notEmpty: true
			},
			unique: "pair"
		},
		level: {
			type: Sequelize.INTEGER,
			defaultValue: 1
		}
	}, {
		timestamps: false
	});