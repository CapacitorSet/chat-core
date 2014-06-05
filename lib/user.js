var irc = require('./protocol'),
    colog = require('colog'),
    sequelize = require('./sequelize');

function User(client, ircServer) {
    this.server = ircServer;
    this.config = ircServer.config;
    this.nick = null;
    this.username = null;
    this.channels = [];
    this.quitMessage = 'Connection lost';
    this.disconnected = false;
    this.pendingAuth = false;
    this.passwordAccepted = false;
    this.lastPing = null;
    this.postAuthQueue = [];
    this.clients =[]; 

    if (client) {
        this.client = client;
    }

    if (client && client.stream) {
        this.stream = client.stream;
        this.remoteAddress = client.stream.remoteAddress;
        this.hostname = client.stream.remoteAddress;
    }

    this.registered = false;
    this.hasPonged = true;
}

User.prototype = {
    get id() {
        return this.username;
    },

    get mask() {
        return ':' + this.username + '!' + this.username + '@' + this.hostname;
    },

    get idle() {
        return parseInt(((new Date()) - this.updated) / 1000, 10);
    },

    send: function() {
        // todo: turn this into "rawsend"
        if (!this.stream) return;

        var self = this,
                message = arguments.length === 1 ?
                    arguments[0]
                : Array.prototype.slice.call(arguments).join(' ');

        colog.info(colog.bold('[' + colog.blue('server->' + this.username) + '] ' + message));

        try {
            this.stream.write(message + '\r\n');
        } catch (exception) {
            colog.error('[' + this.username + '] Error writing to stream:', exception);

            // This setTimeout helps prevent against race conditions when multiple clients disconnect at the same time
            setTimeout(function() {
                if (!self.disconnected) {
                    self.disconnected = true;
                    self.server.disconnect(self);
                }
            }, 1);
        }
    },

    channelNick: function(channel) {
        return (channel.perms[this.username] >= 2) ? '@' + this.username : this.username;
    },

    register: function() {
        if (this.registered === false && this.username) {
            this.send(this.server.host, irc.reply.welcome, this.username, 'Welcome! This server runs Untitled', 'v0.3.0.');
            this.send(this.server.host, irc.reply.suggestLightweight, this.username, 'Operating in legacy mode. Use LW to switch to lightweight mode.');
            this.registered = true;
            this.send(this.mask, "MODE", this.username, '+w', this.username) // todo: only if heavy
        }
    },

    message: function(username, message, callback) {
        var user = this.server.users.find(username);
        this.updated = new Date();

        if (user) {
            user.send(this.mask, 'PRIVMSG', user.username, ':' + message);
            var message = sequelize.models.Message.build({
                from: user.username,
                to: this.username,
                body: message,
                timestamp: new Date().getTime()
            });
        } else {
            // todo: callbackify
            this.send(this.server.host, irc.errors.noSuchNick, this.username, username, ':No such username/channel');
        }
        if (callback) callback();
    },

    queue: function(message) {
        this.postAuthQueue.push(message);
    },

    runPostAuthQueue: function() {
        if (!this.passwordAccepted) return;

        var self = this;

        this.postAuthQueue.forEach(function(message) {
            self.server.respondToMessage(self, message);
        });
    },

    closeStream: function() {
        if (this.stream && this.stream.end) {
            this.stream.end();
        }
    },

    quit: function(message) {
        this.quitMessage = message;
        this.closeStream();
    }
};

exports.User = User;
