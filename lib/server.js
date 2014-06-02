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
    ChannelDatabase = require('./storage').ChannelDatabase,
    UserDatabase = require('./storage').UserDatabase,
    ServerCommands = require('./commands'),
    commander = require('commander'),
    exists = fs.exists || path.exists,
    sequelize = require('./sequelize'),
    colog = require('colog');

function AbstractConnection(stream) {
    this.stream = stream;
    this.object = null;

    this.__defineGetter__('id', function () {
        return this.object ? this.object.id : 'Unregistered';
    });
}

function Server() {
    this.users = new UserDatabase(this);
    this.channels = [];
    this.config = null;
    this.commands = new ServerCommands(this);

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

    version: '0.3.0',
    debug: false,
    get info() { return this.config.serverDescription; },
    get token() { return this.config.token; },
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
        return prefix === '#' || prefix === '&'
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
           this.respondToMessage(client.object, message);
        }
    },

    queueResponse: function(client, message) {
        if ('PASS' === message.command) {
            // Respond now
            client.object.pendingAuth = false;
            this.respondToMessage(client.object, message);
        } else {
            client.object.queue(message);
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
            self.users.forEach(function(user) {
                if (!(user.hasPonged)) {
                    colog.warning('User timed out:', user.mask);
                    self.disconnect(user);
                } else {
                    user.hasPonged = false;
                    user.send('PING something');
                }
            });
        }, timeout * 1000);
    },

    stopTimeoutHandler: function() {
        clearInterval(this.timeoutHandler);
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
                        client = new AbstractConnection(stream);

                client.object = new User(client, server);
                if (server.config.serverPassword) {
                    client.object.pendingAuth = true;
                }

                stream.on('end', function() { server.end(client); });
                stream.on('error', colog.error);
                carry.on('line',    function(line) { server.data(client, line); });
            } catch (exception) {
                colog.error('Fatal error handling a stream:', exception);
            }
        }
    },

    close: function(callback) {
        if (callback !== undefined) {
            assert.ok(typeof callback === 'function');
            this.server.once('close', callback);
        }
        this.stopTimeoutHandler();
        this.server.close();
    },

    end: function(client) {
        var user = client.object;

        if (user) {
            this.disconnect(user);
        }
    },

    disconnect: function(user) {
        user.channels.forEach(function(channel) {
            channel.users.forEach(function(channelUser) {
                if (channelUser !== user) {
                    channelUser.send(user.mask, 'QUIT', user.quitMessage);
                }
            });

            channel.users.splice(channel.users.indexOf(user), 1);
        });

        user.closeStream();
        this.users.remove(user);
        user = null;
    },

    data: function(client, line) {
        line = line.slice(0, 512); // Riduce il comando a massimo 512 caratteri
        colog.info(colog.bold('[' + colog.blue(client.id + '->server') + '] ' + line));
        this.respond(line, client);
        client.object.lastSeen = new Date();
    },

    shutdown: function() {
        console.log('');
        var self = this;
        colog.warning(colog.bold('Shutting down...'));
        self.users.forEach(function(user) {
            user.send('Shutting down!');
            self.disconnect(user);
        });
        colog.warning(colog.bold('Shutdown completed'));
    }
};

exports.Server = Server;

if (!module.parent) {
    Server.boot();
}
