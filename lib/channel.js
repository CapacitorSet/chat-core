var irc = require('./protocol'),
    winston = require('winston'),
    sequelize = require('./sequelize');

function Channel(name, ircServer, callback) {
    this.server = ircServer;
    this.name = name;
    this.users = [];
    this.topic = '';
    this.perms = {};

    var perms = this.perms;

    sequelize.models.ConvoUserPair.findAll({ where: { convo: this.name } }).success(function(items) {
        // This wastes some data because findAll also returns unnecessary data such as ID and convo, but it's more secure than a raw query.

        items.forEach(function(item) {
            perms[item.dataValues.user] = item.dataValues.level;
        });
        if (typeof callback === 'function') {
            callback();
        }
    })
}

Channel.prototype = {
    get names() {
        var channel = this;
        return this.users.map(function(user) {
            return user.channelNick(channel);
        }).join(' ');
    },

    get type() {
        return '*';
    },

    invite: function(username) {
        channel.perms[username] = 1;
        models.ConvoUserPair.create({
                convo: this.name,
                user: username,
                level: 1
        });
    },

    rawSend: function(user, message) {
        var channelName = this.name,
            server = this.server;

        this.users.forEach(function(channelUser) {
            if (channelUser !== user) {
                channelUser.send(user.mask, 'PRIVMSG', channelName, ':' + message);
            }
        });

        sequelize.models.Message.create({
            to: this.name,
            body: message
        });
    },

/* This function is deprecated.
    send: function(user, message) {

        var channelName = this.name,
            server = this.server;

        this.users.forEach(function(channelUser) {
            if (channelUser !== user) {
                channelUser.send(user.mask, 'PRIVMSG', channelName, ':' + message);
            }
        });

        sequelize.models.Message.create({
            to: this.name,
            body: message
        });
    }, */

    findUserNamed: function(nick) {
        nick = this.server.normalizeName(nick);
        for (var i = 0; i < this.users.length; i++) {
            if (this.server.normalizeName(this.users[i].nick) === nick) {
                return this.users[i];
            }
        }
    },

    part: function(user) {
        this.users.splice(this.users.indexOf(user), 1);
        user.channels.splice(user.channels.indexOf(this), 1);
        delete user.channelModes[this];
    },

    join: function(user) {
        if (this.isMember(user)) {
            return;
        }

        // controlla se l'utente può entrare nel canale
        if (typeof this.perms[user] === undefined) {
            user.send(this.server.host, irc.errors.inviteOnly, user.nick, this.name, ':Cannot join channel (+i)');
            return;
        }

        // todo: controllare "veramente" le perms

        this.users.push(user);
        user.channels.push(this);

        var channelName = this.name;

        this.users.forEach(function(channelUser) {
            channelUser.send(user.mask, 'JOIN', channelName);
        });

        if (this.topic) {
            user.send(this.server.host, irc.reply.topic, user.nick, this.name, ':' + this.topic);
        } else {
            user.send(this.server.host, irc.reply.noTopic, user.nick, this.name, ':No topic is set');
        }

        user.send(this.server.host, irc.reply.nameReply, user.nick, '*' /* Represents an invite-only channel in IRC, I think */, this.name, ':' + this.names);
        user.send(this.server.host, irc.reply.endNames, user.nick, this.name, ':End of /NAMES list.');
    },

    isMember: function(user) {
        return this.users.indexOf(user) !== -1;
    }
};

module.exports = Channel;