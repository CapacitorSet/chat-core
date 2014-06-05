var irc = require('./protocol'),
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

    writePerm: function(username, level, callback) {
        var pair = sequelize.models.ConvoUserPair.build({
                convo: this.name,
                user: username,
                level: level
            }),
            errors = pair.validate();
        if (errors === null) {
            // If the pair is valid
            this.perms[username] = level;
            pair.save();
        }
        callback(errors);
    },

    found: function(founder, callback) {
        // Founds the channel, i.e., OPs the founder and writes this permission in the database

        this.writePerm(founder.username, 2, callback);
    },

    invite: function(inviter, username) {
        var server = this.server;
        this.writePerm(username, 1, function(err) {
            if (err) {
                // If the pair is invalid
                inviter.send(server.host, irc.errors.wasNoSuchNick, ':No such username');
            }
        });
    },

    send: function(sender, text, callback) {
        var channelName = this.name; // todo: can this be substituted directly?
        var message = sequelize.models.Message.build({
                from: sender,
                to: channelName,
                body: text,
                timestamp: new Date().getTime()
            }),
            errors = message.validate();

        if (errors === null) {
            // If the pair is valid

            var server = this.server;

            this.users.forEach(function(channelUser) {
                channelUser.send(sender.mask, 'PRIVMSG', channelName, ':' + text);
            });
            message.save();
        }
        if (callback) { callback(errors); }
    },

    broadcast: function() {
        text = Array.prototype.slice.call(arguments, 0).join(' ')
        this.users.forEach(function(user) {
            user.send(text);
        });
    },

    setTopic: function(user, topic, callback) {
        // todo: write topic in db
        if (!(this.perms[user.username] >= 2)) {
            err = 1;
            return;
        } else {
            channel.topic = topic;
            channel.send(user.mask, 'TOPIC', channel.name, ':' + topic);
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
        if (!(this.perms[user.username] >= 1)) {
            user.send(this.server.host, irc.errors.inviteOnly, user.username, this.name, ':Cannot join channel (+i)');
            return;
        }

        this.users.push(user);
        user.channels.push(this);

        this.broadcast(user.mask, 'JOIN', this.name);

        if (this.topic) {
            user.send(this.server.host, irc.reply.topic, user.username, this.name, ':' + this.topic);
        } else {
            user.send(this.server.host, irc.reply.noTopic, user.username, this.name, ':No topic is set');
        }

        user.send(this.server.host, irc.reply.nameReply, user.username, '*' /* Represents an invite-only channel in IRC, I think */, this.name, ':' + this.names);
        user.send(this.server.host, irc.reply.endNames, user.username, this.name, ':End of /NAMES list.');
    },

    isMember: function(user) {
        return this.users.indexOf(user) !== -1;
    }
};

module.exports = Channel;