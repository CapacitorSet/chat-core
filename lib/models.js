var Sequelize = require('sequelize'),
sequelize = require('./sequelize');

// todo: "from" in message

module.exports.Message = sequelize.define('Message', {
	from: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			is: ["^[a-z|0-9]+$",'i'],
			notNull: true,
			notEmpty: true
		}
	},
	to: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			is: ["^[#|&]?[a-z|0-9]+$",'i'],
			notNull: true,
			notEmpty: true
		}
	},
	timestamp: {
		type: Sequelize.BIGINT.UNSIGNED,
		allowNull: false,
		validate: {
			notNull: true,
			notEmpty: true
		}
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
			is: ["^[#|&][a-z|0-9]+",'i'],
			notNull: true,
			notEmpty: true
		},
		unique: "pair"
	},
	user: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			is: ["^[a-z|0-9]+$",'i'],
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

module.exports.User = sequelize.define('User', {
	username: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			isAlphanumeric: true,
			notNull: true,
			notEmpty: true
		},
		unique: true
	},
	password: {
		type: Sequelize.STRING(32),
		allowNull: false,
		validate: {
			is: ["^[0-9|a-f]+$",'i'],
			notNull: true,
			notEmpty: true
		}
	},
	salt: {
		type: Sequelize.STRING(16),
		allowNull: false,
		validate: {
			isAlphanumeric: true,
			notNull: true,
			notEmpty: true
		}
	}
}, {
	timestamps: false
})