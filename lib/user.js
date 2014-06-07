var irc = require('./protocol'),
    colog = require('colog'),
    sequelize = require('./sequelize'),
    async = require('async');

function User(client, server, username) {
    this.server = server;
    this.username = username;
    this.channels = [];
    this.quitMessage = 'Connection lost';
    this.disconnected = false;
    this.clientId = null;

    if (client) {
        this.client = client; // should be dropped as soon as possible
    }

    if (client && client.stream) {
        // same
        this.stream = client.stream;
        this.remoteAddress = client.stream.remoteAddress;
        this.hostname = client.stream.remoteAddress;
    }

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
        var self = this,
                message = arguments.length === 1 ?
                    arguments[0]
                : Array.prototype.slice.call(arguments).join(' ');

        try {
            var devices = this.server.devices[this.username];
            if (devices) {
                async.each(devices,function(deviceId) {
                    self.server.device[deviceId].send(message);
                });
            }
        } catch (exception) {
            colog.error('[' + this.username + '] Error writing to stream:', colog.dump(exception));
        }
    },

    sendSpecial: function() {
        var self = this,
                message = arguments.length === 1 ?
                    arguments[0]
                : Array.prototype.slice.call(arguments).join(' ');

        try {
            var devices = this.server.devices[this.username];
            if (devices) {
                async.each(devices,function(deviceId) {
                    if(self.server.device[deviceId].light){
                        self.server.device[deviceId].send(message);
                    }
                });
            }
        } catch (exception) {
            colog.error('[' + this.username + '] Error writing to stream:', colog.dump(exception));
        }
    },

    channelNick: function(channel) {
        return (channel.perms[this.username] >= 2) ? '@' + this.username : this.username;
    },

    register: function() {
        if (this.registered === false && this.username) {
            this.send(this.server.host, irc.reply.welcome, this.username, 'Welcome! This server runs Untitled', 'v0.3.0.');
            this.registered = true;
            this.send(this.mask, "MODE", this.username, '+w', this.username) 
        }
    },

    message: function(username, message, callback) {
        var user = this.server.users.find(username);

        if (user) {
            user.send(this.mask, 'PRIVMSG', user.username, ':' + message);
            var message = sequelize.models.Message.build({
                from: this.username,
                to: user.username,
                body: message,
                timestamp: new Date().getTime()
            });
        } else {
            // todo: callbackify
            err = 1;
        }
        if (callback) callback(err);
    }
};

exports.User = User;
