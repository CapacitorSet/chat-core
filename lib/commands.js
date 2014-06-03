var irc = require('./protocol'),
    ircd = require('./ircd'),
    fs = require('fs'),
    md5 = require('./md5'),
    models = require('./models'),
    Channel = require('./channel'),
    colog = require('colog'),
    sequelize = require('./sequelize');

function Commands(server) {
    this.server = server;
}

Commands.prototype = {

    LW: function(user) {
        user.send('Not implemented yet!');
//      user.mode = 'light';
    },

    USER: function(user, theUsername) {
        var self = this.server,
            username = theUsername;

        if (!user.password || user.password.length == 0) {
            user.send(self.host, irc.errors.passwordWrong, tsername, ':Password not set');
            user.quit();
            return;
        }

        sequelize.models.User.find({
            where: { username: username }
        }).success(function(item) {
            if (!item) {
                // If the user doesn't exist
                user.send(self.host, irc.errors.passwordWrong, username, ':Password incorrect');
                user.quit();
                return;
            }
            ircd.compareHash(user.password, item.selectedValues.salt, item.selectedValues.password, function(res) {
                if (res) {
                    user.passwordAccepted = true;
                    user.server = self;
                    user.send(user.mask, 'NICK', ':' + user.username);
                    user.runPostAuthQueue();
                    self.users.register(user, username);
                } else {
                    user.send(self.host, irc.errors.passwordWrong, username, ':Password incorrect');
                    user.quit();
                    return;
                }
            });
        });
    },

    PASS: function(user, password) {
        user.password = password;
    },

    VERSION: function(user, server) {
        user.send(this.server.host, irc.reply.version, user.username, 'Untitled', '0.3.0');
    },

    TIME: function(user, server) {
        user.send(this.server.host, irc.reply.time, user.username, this.server.config.hostname, ':' + new Date());
    },

    JOIN: function(user, channelNames) {

        var server = this.server;

        if (!channelNames || !channelNames.length) {
            return user.send(this.server.host, irc.errors.needMoreParams, user.username, ':Need more parameters');
        }

        channelNames.split(',').forEach(function(args) {
            var nameParts = args.split(' '),
                channelName = nameParts[0];

            if (server.channels[channelName]) {
                server.channels[channelName].join(user);
            } else {
                // se il canale non esiste, viene creato
                server.channels[channelName] = new Channel(channelName, server);
                server.channels[channelName].found(user, function(errors) {
                    if (errors) {
                        // If the pair is invalid
                        user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
                        return;
                    }
                    server.channels[channelName].join(user);
                });
            }
        });
    },

    PART: function(user, channelName, partMessage) {
        var Channel = this.server.Channels[channelName];
        if (Channel && user.Channels.indexOf(Channel) !== -1) {
            partMessage = partMessage ? ' :' + partMessage : '';
            Channel.send(user.mask, 'PART', channelName + partMessage);
            Channel.part(user);
        }
    },

    KICK: function(user, channel, username, kickMessage) {

        var channel = this.server.channels[channel],
        targetUser = this.server.users.find(username);

        if (!targetUser) {
            user.send(this.server.host, irc.errors.noSuchNick, user.username, username, ':No such user/channel');
            return;
        } else if (channel) {
            if (channel.perms[user.username] < 2) {
                user.send(this.server.host, irc.errors.channelOpsReq, user.username, channel.name, ":You're not channel operator");
                return;
            } else if (typeof channel.perms[username] === 'undefined') {
                user.send(this.server.host, irc.errors.userNotInChannel, user.username, targetUser.username, ':User isn\'t on that channel');
                return;
            }
        } else if (!this.server.channelTarget(channelName)) {
            // Invalid channel
            return;
        }

        channel.broadcast(user.mask, 'KICK', channel.name, targetUser.username, kickMessage);
        channel.part(targetUser);

        models.ConvoUserPair.find({ where: {
                convo: channel.name,
                user: targetUser.username
        }}) // Cerca il pair appropriato
        .success(function(pair) {
            pair.destroy(); // e lo distrugge
        });
    },

    TOPIC: function(user, channelName) {
        var channel = this.server.channels[channelName],
            topic = Array.prototype.slice.call(arguments, 2).join(' ');

        channel.setTopic(user, topic, function(err) {
            if (err) {
                user.send(this.server.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
            }
        })
    },

    PRIVMSG: function(user, target) {

        var message = Array.prototype.slice.call(arguments, 2).join(' '); // Prende gli argomenti dal secondo in poi, e li mette in una stringa separata da spazi

        if (!target || target.length === 0) {
            user.send(this.server.host, irc.errors.noRecipient, ':No recipient given');
        } else if (!message || message.length === 0) {
            user.send(this.server.host, irc.errors.noTextToSend, ':No text to send');
        } else if (this.server.channelTarget(target)) {
            var channel = this.server.channels[target];
            if (!channel) {
                user.send(this.server.host, irc.errors.noSuchNick, user.username, target, ':No such user/channel');
            } else if (user.channels.indexOf(channel) === -1) {
                // if user doesn't belong to channel.
                // todo: change user.channels.indexOf with chan.perm
                user.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
                return;
            } else {
                this.server.channels[target].send(user, message);
            }
        } else {
            // todo: move message.create in user.message for increased portability
            user.message(target, message);
            models.Message.create({
                to: target,
                body: message
            });
        }
    },

    INVITE: function(user, username, channelName) {
        var channel = this.server.channels[channelName],
            targetUser = this.server.users.find(username);

        if (!targetUser) {
            user.send(this.server.host, irc.errors.noSuchNick, user.username, username, ':No such user/channel');
            return;
        } else if (channel) {
            if (channel.perms[user.username] < 2) {
                user.send(this.server.host, irc.errors.channelOpsReq, user.username, channel.name, ":You're not channel operator");
                return;
            } else if (typeof channel.perms[targetUser] !== 'undefined') {
                user.send(this.server.host, irc.errors.userOnChannel, user.username, targetUser.username, ':User is already on that channel');
                return;
            }
        } else if (!this.server.channelTarget(channelName)) {
            // Invalid channel
            return;
        }/* else {
            // Create the channel
            channel = this.server.channels.registered[this.server.normalizeName(channelName)] = new Channel(channelName, this.server);
        }*/

        user.send(this.server.host, irc.reply.inviting, user.username, targetUser.username, channelName);
        targetUser.send(user.mask, 'INVITE', targetUser.username, ':' + channelName);

        channel.invite(user, targetUser.username);
    },

    NAMES: function(user, targets) {
        var server = this.server;
        if (targets) {
            target = targets.split(',')[0];
                var channel = server.channels[target];
                if (channel && channel.isMember(user)) {
                    user.send(server.host, irc.reply.nameReply, user.username, '*', channel.name, ':' + channel.names);
                }
        }
        user.send(this.server.host, irc.reply.endNames, user.username, '*', ':End of NAMES list.'); 
    },

    WHO: function() {
        // Alias for WHOIS
        this.WHOIS(arguments);
    },

    WHOIS: function(user, username) {
        var target = this.server.users.find(username);
        if (target) {
            // TODO
            user.send(this.server.host, irc.reply.whoIsIdle, user.username, target.username, 'was last seen', 'X', 'seconds ago');
            user.send(this.server.host, irc.reply.endOfWhoIs, user.username, target.username, ':End of WHOIS.');
        } else if (!username || username.length === 0) {
            user.send(this.server.host, irc.errors.noNickGiven, user.username, ':No username given');
        } else {
            user.send(this.server.host, irc.errors.noSuchNick, user.username, username, ':No such username');
        }
    },

    // TODO: WHOWAS

    QUIT: function(user) {
        user.quit(Array.prototype.slice.call(arguments, 2).join(' '));
        delete user;
    },

    PING: function(user) {
        user.send(this.server.host, 'PONG');
    },

    PONG: function(user) {
        user.hasPonged = true;
        user.lastPing = Date.now();
    },
};

module.exports = Commands;
