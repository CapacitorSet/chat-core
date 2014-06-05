'use strict';

var net = require('net'),
    tls = require('tls'),
    carrier = require('carrier'),
    fs = require('fs'),
    irc = require('./protocol'),
    path = require('path'),
    assert = require('assert'),
    Channel = require('./channel'),
    User = require('./user').User,
    ServerCommands = require('./commands'),
    commander = require('commander'),
    exists = fs.exists || path.exists,
    sequelize = require('./sequelize'),
    colog = require('colog'),
    md5 = require('./md5');

function AbstractConnection(stream) {
    this.stream = stream;
    this.username = null;
    this.object = null;

    this.__defineGetter__('id', function () {
        return this.object ? this.object.id : 'Unregistered';
    });
}

AbstractConnection.prototype.send = function() {
    var message = Array.prototype.slice.call(arguments, 0).join(' ');
    colog.info(colog.bold('[' + colog.blue('server->' + this.username + '@' + this.deviceId) + '] ' + message));
    this.stream.write(message + '\r\n');
}

AbstractConnection.prototype.quit = function() {
    this.stream.end();
}

function Server() {
    this.users = {}; // { 'giulio': [User giulio] }
    // todo: load users on boot?
    this.channels = [];
    this.config = null;
    this.commands = new ServerCommands(this);
    this.clients = [];
    this.user = {};
    this.device = {}; // An array of devices ( { deviceId: [AbstractConnection client] })
    this.devices = {}; // An array of users and devices ( { username: [deviceId1, deviceId2, deviceId3] } )

    var server = this;
    process.on('SIGINT', function() {
        server.shutdown();
        process.exit();
    });
}

Server.boot = function() {
    var server = new Server();

    server.file = server.cliParse();

    server.loadConfig(function() {
        server.start();
    });

    process.on('SIGHUP', function() {
        console.log('Reloading config...');
        server.loadConfig();
    });
};

Server.prototype = {

    get host() { return ':' + this.config.hostname; },

    cliParse: function() {
        var file = null;

        commander.option('-f --file [file]','Configuration file (Defaults: /etc/ircdjs/config.json or ../config/config.json)')
            .parse(process.argv);
        // When the -f switch is passwd without a parameter, commander.js evaluates it to true.
        if (commander.file && commander.file !== true) file = commander.file;
        return file;
    },

    loadConfig: function(fn) {
        var server = this,
            paths = [
                path.join('/', 'etc', 'ircdjs', 'config.json'),
                path.join(__dirname, '..', 'config', 'config.json')
            ];

        this.config = null;
        if (server.file) paths.unshift(server.file);

        paths.forEach(function(name) {
            exists(name, function(exists) {
                if (!exists || server.config) return;
                    server.config = JSON.parse(fs.readFileSync(name).toString());
                    server.config.idleTimeout = server.config.idleTimeout || 60;
                    colog.info('Using config file: ' + name);
                    if (fn) fn();
            });
        });

    sequelize.query('SELECT DISTINCT convo FROM ConvoUserPairs').success(function(result){
        colog.info('Loading conversations...')
        result.forEach(function(item) {
            // Generates an appropriate Channel
            server.channels[item.convo] = new Channel(item.convo, server, function() {
                colog.info('Loaded conversation '+item.convo);
            });
        });
    });

    },

    normalizeName: function(name) {
        return name &&
                     name.toLowerCase()
                     .replace(/{/g, '[')
                     .replace(/}/g, ']')
                     .replace(/\|/g, '\\')
                     .trim();
    },

    isValidPositiveInteger: function(str) {
        var n = ~~Number(str);
        return String(n) === str && n >= 0;
    },

    valueExists: function(value, collection, field) {
        var self = this;
        value = this.normalizeName(value);
        return collection.some(function(u) {
            return self.normalizeName(u[field]) === value;
        })
    },

    channelTarget: function(target) {
        var prefix = target[0];
        return (prefix === '#' || prefix === '&');
    },

    parse: function(data) {
        var parts = data.trim().split(/ :/),
                args = parts[0].split(' ');

        parts = [parts.shift(), parts.join(' :')];

        if (parts.length > 0) {
            args.push(parts[1]);
        }

        if (data.match(/^:/)) {
            args[1] = args.splice(0, 1, args[1]);
            args[1] = (args[1] + '').replace(/^:/, '');
        }

        return {
            command: args[0].toUpperCase(),
            args: args.slice(1)
        };
    },

    respondToMessage: function(user, message) {
        this.commands[message.command].apply(this.commands, [user].concat(message.args));
    },

    respond: function(data, client) {
        var message = this.parse(data);

        if (this.validCommand(message.command)) {
           this.respondToMessage(client, message);
        }
    },

    validCommand: function(command) {
        return this.commands[command];
    },

    startTimeoutHandler: function() {
        var self = this;
        var timeout = this.config.pingTimeout;
        this.timeoutHandler = setInterval(function() {
            console.log('Checking users now');
            // TODO: pings aren't sent at all
            self.clients.forEach(function(client) {
                if (!(client.hasPonged)) {
                    var user = client.object,
                        username = user.username;

                    var index = self.clients.indexOf(client);
                    self.clients.splice(index, 1); // Rimuove il client

                    delete self.device[user.deviceId];
                    if (username) {
                        var index = self.devices[username].indexOf(user.deviceId);
                        self.devices[username].splice(index, 1);
                    }

                    client.quit();

                    colog.info(colog.bold('[' + colog.yellow(username) + '] User timed out'));
                } else {
                    client.hasPonged = false;
                    client.send('PING something');
                }
            });
        }, timeout * 1000);
    },

    start: function(callback) {
        'use strict';
        var server = this, key, cert, options;

        if (this.config.key && this.config.cert) {
            try {
                key = fs.readFileSync(this.config.key);
                cert = fs.readFileSync(this.config.cert);
            } catch (exception) {
                colog.error('Error reading TLS key/cert:', exception);
            }
            options = { key: key, cert: cert };
            this.server = tls.createServer(options, handleStream);
        } else {
            this.server = net.createServer(handleStream);
        }

        assert.ok(callback === undefined || typeof callback == 'function');
        this.server.listen(this.config.port, callback);
        colog.success('Server booted successfully!');
        colog.log(colog.bold('Listening on port ' + this.config.port));

        this.startTimeoutHandler();

        function handleStream(stream) {
            try {
                var carry = carrier.carry(stream),
                    client = new AbstractConnection(stream),
                    deviceId = md5(String(new Date().getTime()));

                client.object = new User(client, server);
                client.deviceId = deviceId;
                client.object.deviceId = deviceId; // should be dropped in favour of client.deviceId
                server.device[deviceId] = client;

                stream.on('end', function() { server.end(client); });
                stream.on('error', colog.error);
                carry.on('line',    function(line) { server.data(client, line); });
            } catch (exception) {
                colog.error('Fatal error handling a stream:', colog.dump(exception));
            }
        }
    },

    end: function(client) {
        var user = client.object;

        if (client.objec) {
            this.disconnect(client);
        }
    },

/*  disconnect: function(client) {
        // todo: rewrite using clients rather than users
        delete this.server.device[user.deviceId];
        if (user.username) {
            var index = this.server.devices[user.username].indexOf(user.deviceId);
            this.server.devices[user.username].splice(index, 1);
        }
        delete user;

        user.channels.forEach(function(channel) {
            channel.users.forEach(function(channelUser) {
                if (channelUser !== user) {
                    channelUser.send(user.mask, 'QUIT', user.quitMessage);
                }
            });

            channel.users.splice(channel.users.indexOf(user), 1);
        });

        user.closeStream();
        user = null;
    },*/

    data: function(client, line) {
        line = line.slice(0, 512); // Riduce il comando a massimo 512 caratteri
        colog.info(colog.bold('[' + colog.blue(client.username + '@' + client.deviceId + '->server') + '] ' + line));
        this.respond(line, client);
        client.object.lastSeen = new Date();
    },

    shutdown: function() {
        console.log('');
        // Placeholder
        colog.success('Shutdown complete!');
    }
};

exports.Server = Server;

if (!module.parent) {
    Server.boot();
}
