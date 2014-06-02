var Channel = require('./channel').Channel,
        irc = require('./protocol'),
        sequelize = require('./sequelize'),
        models = require('./models');

function UserDatabase(server) {
    this.server = server;
    this.config = server.config;
    this.registered = [];
}

UserDatabase.prototype = {
    forEach: function(fn) {
        this.registered.forEach(fn);
    },

    push: function(user) {
        this.registered.push(user);
    },

    register: function(user, username) {
        user.username = username;
        this.registered.push(user);
        user.register();
    },

    find: function(username) {
        username = this.server.normalizeName(username);
        for (var i = 0; i < this.registered.length; i++) {
            if (this.registered[i] && this.server.normalizeName(this.registered[i].username) === username)
                return this.registered[i];
        }
    },

    remove: function(user) {
        if (this.registered.indexOf(user) !== -1) {
            this.registered.splice(this.registered.indexOf(user), 1);
        }
    }
};

exports.UserDatabase = UserDatabase;