var irc = require('./protocol'),
    ircd = require('./ircd'),
    fs = require('fs'),
    md5 = require('./md5'),
    models = require('./models'),
    User = require('./user').User,
    Channel = require('./channel'),
    colog = require('colog'),
    sequelize = require('./sequelize'),
    Sequelize = require('sequelize');

function Commands(server) {
    this.server = server;
}

Commands.prototype = {

    FETCH: function(client, timestamp) {
        sequelize.models.Message.findAll({
            where: Sequelize.and({
                timestamp: {
                    gt: timestamp
                }},
                Sequelize.or({
                    to: user.username
                }, {
                    from: user.username
                }))
        }).success(function(items) {
            items.forEach(function(message) {
                client.send(JSON.stringify(message.dataValues));
            })
        })
    },

    USER: function(client, theUsername) {
        var self = this.server,
            username = theUsername;

        if (!client.password || client.password.length == 0) {
            client.send(self.host, irc.errors.passwordWrong, username, ':Password not set');
            client.quit();
            return;
        }

        sequelize.models.User.find({
            where: { username: username }
        }).success(function(item) {
            if (!item) {
                // If the user doesn't exist
                client.send(self.host, irc.errors.passwordWrong, username, ':Password incorrect');
                client.quit();
                return;
            }
            ircd.compareHash(client.password, item.selectedValues.salt, item.selectedValues.password, function(res) {
                if (res) {
                    if (!self.user[username]) {
                        self.user[username] = new User(client, self, username);
                    }

                    user = self.user[username];

                    client.username = username;
                    client.send(user.mask, 'NICK', ':' + username);
                    client.send(self.host, irc.reply.welcome, username, 'Welcome! This server runs Untitled', 'v0.3.0.');
                    client.send(user.mask, "MODE", username, '+w', username);

                    if (!self.devices[username]) { self.devices[username] = [] }
                    self.devices[username].push(client.deviceId)

                } else {
                    client.send(self.host, irc.errors.passwordWrong, username, ':Password incorrect');
                    client.quit();
                    return;
                }
            });
        });
    },

    PASS: function(client, password) {
        client.password = password;
    },

    VERSION: function(client, server) {
        client.send(this.server.host, irc.reply.version, user.username, 'Untitled', '0.3.0');
    },

    TIME: function(client, server) {
        client.send(this.server.host, irc.reply.time, user.username, this.server.config.hostname, ':' + new Date());
    },

    JOIN: function(client, channelNames) {
        var user = client.object;

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

    PART: function(client, channelName, partMessage) {
        var user = client.object;
        var Channel = this.server.Channels[channelName];
        if (Channel && user.Channels.indexOf(Channel) !== -1) {
            partMessage = partMessage ? ' :' + partMessage : '';
            Channel.send(user.mask, 'PART', channelName + partMessage);
            Channel.part(user);
        }
    },

    KICK: function(client, channel, username, kickMessage) {
        var user = client.object;

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

    TOPIC: function(client, channelName) {
        var user = client.object;
        var channel = this.server.channels[channelName],
            topic = Array.prototype.slice.call(arguments, 2).join(' ');

        channel.setTopic(user, topic, function(err) {
            if (err) {
                user.send(this.server.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
            }
        })
    },

    PRIVMSG: function(client, target) {
        var self = this;

        var message = Array.prototype.slice.call(arguments, 2).join(' '); // Prende gli argomenti dal secondo in poi, e li mette in una stringa separata da spazi

        if (!target || target.length === 0) {
            client.send(this.server.host, irc.errors.noRecipient, ':No recipient given');
        } else if (!message || message.length === 0) {
            client.send(this.server.host, irc.errors.noTextToSend, ':No text to send');
        } else if (this.server.channelTarget(target)) {
            var channel = this.server.channels[target];
            if (!channel) {
                client.send(this.server.host, irc.errors.noSuchNick, client.username, target, ':No such user/channel');
            } else if (!channel.perm) {
                // if user doesn't have perms to write in the channel
                client.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
                return;
            } else {
                this.server.channels[target].send(client.username, message);
            }
        } else {
            var recipient = this.server.user[target],
                user = this.server.user[client.username];
            if (recipient) {
                user.send(user.mask, 'PRIVMSG', recipient.username, ':' + message);
                recipient.send(user.mask, 'PRIVMSG', recipient.username, ':' + message);
                sequelize.models.Message.create({
                    from: client.username,
                    to: recipient.username,
                    body: message,
                    timestamp: new Date().getTime()
                });
            } else {
                client.send(self.server.host, irc.errors.noSuchNick, client.username, target, ':No such username/channel');
            }
        }
    },

    INVITE: function(client, username, channelName) {
        var user = client.object;
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

    NAMES: function(client, targets) {
        var user = client.object;
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

    WHO: function(client, target) {
        var user = client.object;
        // Alias for WHOIS
        var channel = this.server.channels[target];
        if (channel) {
            // If the second argument refers to a channel, interpret WHO as NAMES.
            this.NAMES(user, target);
        } else {
            // Else, interpret it as WHOIS.
            this.WHOIS(user, target);
        }
    },

    WHOIS: function(client, username) {
        var user = client.object;
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

    QUIT: function(client) {
        client.quit();
        delete this.server.device[client.deviceId];
        if (client.username) {
            var index = this.server.devices[client.username].indexOf(client.deviceId);
            this.server.devices[client.username].splice(index, 1);
        }
    },

    PING: function(client) {
        client.send(this.server.host, 'PONG');
        client.hasPonged = true;
    },

    PONG: function(client) {
        client.hasPonged = true;
    },
};

module.exports = Commands;
