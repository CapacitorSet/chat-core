var irc = require('./protocol'),
    winston = require('winston'),
    sequelize = require('./sequelize');

function tehChannel(name, ircServer, callback) {
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

tehChannel.prototype = {
    get names() {
        var channel = this;
        return this.users.map(function(user) {
            return user.channelNick(channel);
        }).join(' ');
    },

    get type() {
        return '*';
    },

    message: function(user, message) {
        console.log('warning, chiamato tehChannel.prototype.message, che è un alias a send');
        this.send(arguments);
    },

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
    },

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

function Channel(name, ircServer) {

    this.server = ircServer;
    this.name = name;
    this.users = [];
    this.topic = '';
    this._modes = ['n', 't', 'r', 'i'];
    this.banned = [];
    this.userLimit = 0;
    this.inviteList = [];
}

Channel.prototype = {
    get modes() {
        return '+' + this._modes.join(''); 
    },

    set modes(modes) {
        this._modes = modes.split('');
    },

    get memberCount() {
        return this.users.length;
    },

    get isLimited() {
        return this._modes.indexOf('l') > -1;
    },

    get isPublic() {
        return false;
    },

    get isSecret() {
        return true;
    },

    get isPrivate() {
        return true;
    },

    get isModerated() {
        return this._modes.indexOf('m') > -1;
    },

    get isInviteOnly() {
        return true;
    },

    get names() {
        var channel = this;
        return this.users.map(function(user) {
            return user.channelNick(channel);
        }).join(' ');
    },

    get type() {
        return '*';
    },

    onInviteList: function(user) {
        var userNick = this.server.normalizeName(user.nick),
                server = this.server;
        return this.inviteList.some(function(nick) {
            return server.normalizeName(nick) === userNick;
        });
    },

    isBanned: function(user) {
        return this.banned.some(function(ban) {
            return user.matchesMask(ban.mask);
        });
    },

    banMaskExists: function(mask) {
        return this.banned.some(function(ban) {
            return ban.mask === mask;
        });
    },

    findBan: function(mask) {
        for (var i in this.banned) {
            if (this.banned[i].mask === mask) {
                return this.banned[i];
            }
        }
    },

    sendToGroup: function(users, message) {
        var server = this.server;

        users.forEach(function(user) {
            try {
                user.send(message);
            } catch (exception) {
                winston.error('Error writing to stream:', exception);
            }
        });
    },

    send: function() {
        var message = arguments.length === 1 ? arguments[0] : Array.prototype.slice.call(arguments).join(' '),
                server = this.server;

        this.users.forEach(function(user) {
            try {
                user.send(message);
            } catch (exception) {
                winston.error('Error writing to stream:', exception);
            }
        });
    },

    findUserNamed: function(nick) {
        nick = this.server.normalizeName(nick);
        for (var i = 0; i < this.users.length; i++) {
            if (this.server.normalizeName(this.users[i].nick) === nick) {
                return this.users[i];
            }
        }
    },

    isMember: function(user) {
        return this.users.indexOf(user) !== -1;
    },

    addModes: function(user, modes, arg) {
        var channel = this;
        modes.slice(1).split('').forEach(function(mode) {
            if (channel.addMode[mode])
                channel.addMode[mode].apply(channel, [user, arg]);
        });
    },

    opModeAdd: function(mode, user, arg) {
        if (user.isOp(this)) {
            if (this.modes.indexOf(mode) === -1) {
                this.modes += mode;
                this.send(user.mask, 'MODE', this.name, '+' + mode, this.name);
                return true;
            }
        } else {
            user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
        }
        return false;
    },

    opModeRemove: function(mode, user, arg) {
        if (user.isOp(this)) {
            if (this.modes.indexOf(mode) !== -1) {
                this.modes = this.modes.replace(mode, '');
                this.send(user.mask, 'MODE', this.name, '-' + mode, this.name);
                return true;
            }
        } else {
            user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
        }
        return false;
    },

    addMode: {
        o: function(user, arg) {
            if (user.isOp(this)) {
                var targetUser = this.findUserNamed(arg);
                if (targetUser && !targetUser.isOp(this)) {
                    targetUser.op(this);
                    this.send(user.mask, 'MODE', this.name, '+o', targetUser.nick);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        },

        h: function(user, arg) {
            if (user.isOp(this)) {
                var targetUser = this.findUserNamed(arg);
                if (targetUser && !targetUser.isHop(this)) {
                    targetUser.hop(this);
                    this.send(user.mask, 'MODE', this.name, '+h', targetUser.nick);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        },

        v: function(user, arg) {
            if (user.isHop(this)) {
                var targetUser = this.findUserNamed(arg);
                if (targetUser && !targetUser.isVoiced(this)) {
                    targetUser.voice(this);
                    this.send(user.mask, 'MODE', this.name, '+v', targetUser.nick);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're must be at least half-op to do that!");
            }
        },

        l: function(user, arg) {
            if (user.isOp(this)) {
                if (this.server.isValidPositiveInteger(arg)) {
                     var limit = parseInt(arg, 10);
                     if (this.userLimit != limit) {
                         this.modes += 'l';
                         this.userLimit = limit;
                         this.send(user.mask, 'MODE', this.name, '+l ' + arg, this.name);
                     }
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        },

        m: function(user, arg) {
            this.opModeAdd('m', user, arg);
        },

        n: function(user, arg) {
            this.opModeAdd('n', user, arg);
        },

        t: function(user, arg) {
            this.opModeAdd('t', user, arg);
        },

        p: function(user, arg) {
            this.opModeAdd('p', user, arg);
        },

        s: function(user, arg) {
            this.opModeAdd('s', user, arg);
        },

        b: function(user, arg) {
            if (user.isOp(this)) {
                // TODO: Valid ban mask?
                if (!arg || arg.length === 0) {
                    user.send(this.server.host, irc.errors.needMoreParams, user.nick, this.name, ":Please enter ban mask");
                } else if (!this.banMaskExists(arg)) {
                    this.banned.push({ user: user, mask: arg, timestamp: (new Date()).valueOf() });
                    this.send(user.mask, 'MODE', this.name, '+b', ':' + arg);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        }
    },

    removeModes: function(user, modes, arg) {
        var channel = this;
        modes.slice(1).split('').forEach(function(mode) {
            if (channel.removeMode[mode])
                channel.removeMode[mode].apply(channel, [user, arg]);
        });
    },

    removeMode: {
        o: function(user, arg) {
            if (user.isOp(this)) {
                var targetUser = this.findUserNamed(arg);
                if (targetUser && targetUser.isOp(this)) {
                    targetUser.deop(this);
                    this.send(user.mask, 'MODE', this.name, '-o', targetUser.nick);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        },

        v: function(user, arg) {
            if (user.isOp(this)) {
                var targetUser = this.findUserNamed(arg);
                if (targetUser && targetUser.isVoiced(this)) {
                    targetUser.devoice(this);
                    this.send(user.mask, 'MODE', this.name, '-v', targetUser.nick);
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        },

        l: function(user, arg) {
            if (this.opModeRemove('l', user, arg, ' ' + arg)) {
                this.userLimit = 0;
            }
        },

        m: function(user, arg) {
            this.opModeRemove('m', user, arg);
        },

        n: function(user, arg) {
            this.opModeRemove('n', user, arg);
        },

        t: function(user, arg) {
            this.opModeRemove('t', user, arg);
        },

        p: function(user, arg) {
            this.opModeRemove('p', user, arg);
        },

        s: function(user, arg) {
            this.opModeRemove('s', user, arg);
        },

        b: function(user, arg) {
            if (user.isOp(this)) {
                // TODO: Valid ban mask?
                if (!arg || arg.length === 0) {
                    user.send(this.server.host, irc.errors.needMoreParams, user.nick, this.name, ":Please enter ban mask");
                } else {
                    var ban = this.findBan(arg);
                    if (ban) {
                        this.banned.splice(this.banned.indexOf(ban), 1);
                        this.send(user.mask, 'MODE', this.name, '-b', ':' + arg);
                    }
                }
            } else {
                user.send(this.server.host, irc.errors.channelOpsReq, user.nick, this.name, ":You're not channel operator");
            }
        }
    },

    part: function(user) {
        this.users.splice(this.users.indexOf(user), 1);
        user.channels.splice(user.channels.indexOf(this), 1);
        delete user.channelModes[this];
    }
};

exports.Channel = Channel;
exports.tehChannel = tehChannel;