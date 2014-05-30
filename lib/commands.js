var irc = require('./protocol'),
    ircd = require('./ircd'),
    fs = require('fs'),
    md5 = require('./md5'),
    models = require('./models');

function Commands(server) {
    this.server = server;
}

Commands.prototype = {

    LW: function(user) {
        user.send('Not implemented yet!');
//      user.mode = 'light';
    },

    USER: function(user, username) {
        var self = this.server;
        fs.readFile('profiles/'+md5(username), 'utf8', function(err, data) {
            if (err !== null) {
                console.log(err);
                user.quit();
                return;
            }
            if (!user.password || user.password.length == 0) {
                user.send(self.host, irc.errors.passwordWrong, username, ':Password not set');
                user.quit();
                return;
            }
            ircd.compareHash(user.password, data, function(res) {
                if (res) {
                    user.passwordAccepted = true;
                    user.server = self;
                    user.runPostAuthQueue();
                } else {
                    user.send(self.host, irc.errors.passwordWrong, username, ':Password incorrect');
                    user.quit();
                    return;
                }
            });

            self.users.register(user, username);
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

    NICK: function(user, nick) {
// todo: verificare se il nick è valido
        var oldMask = user.mask;

        if (!nick || nick.length === 0) {
            return user.send(this.server.host, irc.errors.noNickGiven, ':No nickname given');
        } else if (nick === user.nick) {
            return;
        } else if (nick.length > (this.server.config.maxNickLength || 9) || nick.match(irc.validations.invalidNick)) {
            return user.send(this.server.host, irc.errors.badNick, (user.nick || ''), nick, ':Erroneus nickname');
        } else if (this.server.valueExists(nick, this.server.users.registered, 'nick')) {
            return user.send(this.server.host, irc.errors.nameInUse, '*', nick, ':is already in use');
        }

        nick = nick.trim();
        user.send(user.mask, 'NICK', ':' + nick);

        user.channels.forEach(function(channel) {
            var users = channel.users.splice(channel.users.indexOf(user), 1);
            channel.sendToGroup(users, user.mask + ' NICK : ' + nick);
        });

        user.nick = nick.trim();
        user.register();
    },

    JOIN: function(user, channelNames, key) {

        var server = this.server;
        if (!channelNames || !channelNames.length) {
            return user.send(this.server.host, irc.errors.needMoreParams, user.username, ':Need more parameters');
        }
        channelNames.split(',').forEach(function(args) {
            var nameParts = args.split(' '),
                    channelName = nameParts[0];

            if (!server.channelTarget(channelName)
                    || channelName.match(irc.validations.invalidChannel)) {
                // Se si è fatto es. "/join qualcosa" (senza #) o "/join nomenonvalidoperuncanale"
                user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
            } else {
                server.channels[channelName].join(user);
                /*
                if (this.server.channels.perm[channelName] === undefined) {
                    // se il canale non esiste, viene creato
                    models.ConvoUserPair.create({
                    convo: channelName,
                    user: user.nick,
                    level: 2
                    });
                }
                */
            }
        });
    },

    PART: function(user, channelName, partMessage) {
        var tehChannel = this.server.tehChannels.find(channelName);
        if (tehChannel && user.tehChannels.indexOf(tehChannel) !== -1) {
            partMessage = partMessage ? ' :' + partMessage : '';
            tehChannel.send(user.mask, 'PART', channelName + partMessage);
            tehChannel.part(user);
        }
    },

    KICK: function(user, channels, users, kickMessage) {

// todo: rewrite

        var channelMasks = channels.split(','),
                userNames = users.split(','),
                server = this.server;

        kickMessage = kickMessage ? ':' + kickMessage : ':' + user.username;

        // ERR_BADCHANMASK

        if (userNames.length !== channelMasks.length) {
            user.send(this.server.host, irc.errors.needMoreParams, user.username, ':Need more parameters');
        } else {
            channelMasks.forEach(function(channelMask, i) {
                var channel = server.channels.findWithMask(channelMask),
                        userName = userNames[i],
                        targetUser;

                if (!channel) {
                    user.send(server.host, irc.errors.noSuchChannel, ':No such channel');
                    return;
                }

                targetUser = channel.findUserNamed(userName);

                if (!channel.findUserNamed(user.nick)) {
                    user.send(server.host, irc.errors.notOnChannel, user.username, channel.name, ':Not on channel');
                } else if (!targetUser) {
                    user.send(server.host, irc.errors.userNotInChannel, userName, channel.name, ':User not in channel');
                } else if (!user.isOp(channel)) {
                    user.send(server.host, irc.errors.channelOpsReq, user.username, channel.name, ":You're not channel operator");
                } else {
                    channel.send(user.mask, 'KICK', channel.name, targetUser.username, kickMessage);
                    channel.part(targetUser);
                }
            });
        }
    },

    TOPIC: function(user, channelName) {
        var channel = this.server.channels.find(channelName),
            topic = Array.prototype.slice.call(arguments, 2).join(' ');

        if (!channel) {
            user.send(this.server.host, irc.errors.noSuchNick, user.nick, channelName, ':No such nick/channel');
        } else {
            if (channel.modes.indexOf('t') === -1 || user.isHop(channel)) {
                channel.topic = topic;
                channel.send(user.mask, 'TOPIC', channel.name, ':' + topic);
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, channel.name, ":You must be at least half-op to do that!");
            }
        }
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
            } else if (channel.isModerated && !user.isVoiced(channel)) {
                user.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
            } else if (user.channels.indexOf(channel) === -1) {
                if (channel.modes.indexOf('n') !== -1) {
                    user.send(this.server.host, irc.errors.cannotSend, channel.name, ':Cannot send to channel');
                    return;
                }
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

        // TODO: ERR_NOTONCHANNEL
        if (!targetUser) {
            user.send(this.server.host, irc.errors.noSuchNick, user.username, username, ':No such user/channel');
            return;
        } else if (channel) {
            if (channel.isInviteOnly && !user.isOp(channel)) {
                user.send(this.server.host, irc.errors.channelOpsReq, user.username, channel.name, ":You're not channel operator");
                return;
            } else if (typeof channel.perms[targetUser] !== 'undefined') {
                user.send(this.server.host, irc.errors.userOnChannel, user.username, targetUser.username, ':User is already on that channel');
                return;
            }
        } else if (!this.server.channelTarget(channelName)) {
            // Invalid channel
            return;
        } else {
            // Create the channel
            channel = this.server.channels.registered[this.server.normalizeName(channelName)] = new Channel(channelName, this.server);
        }

        user.send(this.server.host, irc.reply.inviting, user.username, targetUser.username, channelName);
        targetUser.send(user.mask, 'INVITE', targetUser.username, ':' + channelName);

        models.ConvoUserPair.create({
                convo: channel.name,
                user: targetUser.username,
                level: 1
        });
    },

    MODE: function(user, target, modes, arg) {
        // TODO: This should work with multiple parameters, like the definition:
        // <channel> {[+|-]|o|p|s|i|t|n|b|v} [<limit>] [<user>] [<ban mask>]
        // o - give/take channel operator privileges                                     [done]
        // p - private channel flag                                                                        [done]
        // s - secret channel flag;                                                                        [done] - what's the difference?
        // i - invite-only channel flag;                                                             [done]
        // t - topic settable by channel operator only flag;                     [done]
        // n - no messages to channel from clients on the outside;         [done]
        // l - set the user limit to channel;                                                    [done]
        // b - set a ban mask to keep users out;

        // User modes
        // r - restricted user connection;
        // o - operator flag;
        // O - local operator flag;
        // s - marks a user for receipt of server notices.
        var server = this.server;

        if (this.server.channelTarget(target)) {
            var channel = this.server.channels.find(target);
            if (!channel) {
                // TODO: Error
            } else if (modes) {
                if (modes[0] === '+') {
                    channel.addModes(user, modes, arg);
                } else if (modes[0] === '-') {
                    channel.removeModes(user, modes, arg);
                }
            } else {
                user.send(this.server.host, irc.reply.channelModes, user.nick, channel.name, channel.modes);
            }
        } else {
            // TODO: Server user modes
            var targetUser = this.server.users.find(target);
            if (targetUser) {
                if (modes[0] === '+') {
                    targetUser.addModes(user, modes, arg);
                } else if (modes[0] === '-') {
                    targetUser.removeModes(user, modes, arg);
                }
            }
        }
    },

    LIST: function(user, targets) {
        // TODO: ERR_TOOMANYMATCHES
        // TODO: ERR_NOSUCHSERVER
        var server = this.server,
                channels = {};
        user.send(this.server.host, irc.reply.listStart, user.nick, 'Channel', ':Users    Name');
        if (targets) {
            targets = targets.split(',');
            targets.forEach(function(target) {
                var channel = server.channels.find(target);
                if (channel) {
                    channels[channel.name] = channel;
                }
            });
        } else {
            channels = this.server.channels.registered;
        }

        for (var i in channels) {
            var channel = channels[i];
            // if channel is secret or private, ignore
            if (channel.isPublic || channel.isMember(user)) {
                user.send(this.server.host, irc.reply.list, user.nick, channel.name, channel.memberCount, ':[' + channel.modes + '] ' + channel.topic);
            }
        }

        user.send(this.server.host, irc.reply.listEnd, user.nick, ':End of /LIST');
    },

    // TODO: LIST
    NAMES: function(user, targets) {
        var server = this.server;
        if (targets) {
            targets = targets.split(',');
            targets.forEach(function(target) {
                // if channel is secret or private, ignore
                var channel = server.channels.find(target);
                if (channel && channel.isMember(user)) {
                    user.send(server.host, irc.reply.nameReply, user.nick, channel.type, channel.name, ':' + channel.names);
                }
            });
        }
        user.send(this.server.host, irc.reply.endNames, user.nick, '*', ':End of NAMES list.'); 
    },

    WHO: function(user, target) {
        var server = this.server;

        if (this.server.channelTarget(target)) {
            // TODO: Channel wildcards
            var channel = this.server.channels.find(target);

            if (!channel) {
                user.send(this.server.host, irc.errors.noSuchChannel, user.nick, ':No such channel');
            } else {
                channel.users.forEach(function(channelUser) {
                    if (channelUser.isInvisible
                            && !user.isOper
                            && channel.users.indexOf(user) === -1) {
                            return;
                    } else {
                        user.send(server.host,
                                            irc.reply.who,
                                            user.nick,
                                            channel.name,
                                            channelUser.username,
                                            channelUser.hostname,
                                            server.config.hostname, // The IRC server rather than the network
                                            channelUser.channelNick(channel),
                                            'H', // TODO: H is here, G is gone, * is IRC operator, + is voice, @ is chanop
                                            ':0',
                                            channelUser.realname);
                    }
                });
                user.send(this.server.host, irc.reply.endWho, user.nick, channel.name, ':End of WHO list.');
            }
        } else {
            var matcher = this.server.normalizeName(target).replace(/\?/g, '.');
            this.server.users.registered.forEach(function(targetUser) {
                try {
                    if (!targetUser.nick.match('^' + matcher + '$')) return;
                } catch (e) {
                    return;
                }

                var sharedChannel = targetUser.sharedChannelWith(user);
                if (targetUser.isInvisible
                        && !user.isOper
                        && !sharedChannel) {
                        return;
                } else {
                    user.send(server.host,
                                        irc.reply.who,
                                        user.nick,
                                        sharedChannel ? sharedChannel.name : '',
                                        targetUser.username,
                                        targetUser.hostname,
                                        server.config.hostname,
                                        targetUser.channelNick(channel),
                                        'H', // TODO
                                        ':0',
                                        targetUser.realname);
                }
            });
            user.send(this.server.host, irc.reply.endWho, user.nick, target, ':End of WHO list.');
        }
    },

    WHOIS: function(user, nickmask) {
        // TODO: nick masks
        var target = this.server.users.find(nickmask);
        if (target) {
            var channels = target.channels.map(function(channel) {
                if (channel.isSecret && !channel.isMember(user)) return;

                if (target.isOp(channel)) {
                    return '@' + channel.name;
                } else {
                    return channel.name;
                }
            });

            user.send(this.server.host, irc.reply.whoIsUser, user.nick, target.nick,
                                target.username, target.hostname, '*', ':' + target.realname);
            user.send(this.server.host, irc.reply.whoIsChannels, user.nick, target.nick, ':' + channels);
            user.send(this.server.host, irc.reply.whoIsServer, user.nick, target.nick, this.server.config.hostname, ':' + this.server.config.serverDescription);
            user.send(this.server.host, irc.reply.whoIsIdle, user.nick, target.nick, target.idle, user.created, ':seconds idle, sign on time');
            user.send(this.server.host, irc.reply.endOfWhoIs, user.nick, target.nick, ':End of WHOIS list.');
        } else if (!nickmask || nickmask.length === 0) {
            user.send(this.server.host, irc.errors.noNickGiven, user.nick, ':No nick given');
        } else {
            user.send(this.server.host, irc.errors.noSuchNick, user.nick, nickmask, ':No such nick/channel');
        }
    },

    QUIT: function(user, message) {
        user.quit(message);
        delete user;
    },

    PING: function(user, hostname) {
        user.lastPing = Date.now();
        user.send(this.server.host, 'PONG', this.server.config.hostname, this.server.host);
    },

    PONG: function(user, hostname) {
        user.lastPing = Date.now();
    },
};

module.exports = Commands;
