/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

/**
 *      CUL/COC / culfw Node.js module
 *      https://github.com/hobbyquaker/cul
 *
 *      Licensed under GPL v2
 *      Copyright (c) 2014-2018 hobbyquaker <hq@ccu.io>
 *
 */

const util = require('util');
const {EventEmitter} = require('events');
/*
const protocol = {
    em: require('./lib/em.js'),
    fs20: require('./lib/fs20.js'),
    hms: require('./lib/hms.js'),
    it: require('./lib/it.js'),
    moritz: require('./lib/moritz.js'),
    uniroll: require('./lib/uniroll.js'),
    ws: require('./lib/ws.js'),
    fht: require('./lib/fht.js'),
    esa: require('./lib/esa.js')
};
*/
const protocol = {
    em: require('/data/dev/cul/lib/em.js'),
    fs20: require('/data/dev/cul/lib/fs20.js'),
    hms: require('/data/dev/cul/lib/hms.js'),
    it: require('/data/dev/cul/lib/it.js'),
    moritz: require('/data/dev/cul/lib/moritz.js'),
    uniroll: require('/data/dev/cul/lib/uniroll.js'),
    ws: require('/data/dev/cul/lib/ws.js'),
    fht: require('/data/dev/cul/lib/fht.js'),
    esa: require('/data/dev/cul/lib/esa.js')
};

// http://culfw.de/commandref.html
const commands = {
    F: 'FS20',
    T: 'FHT',
    E: 'EM',
    W: 'WS',
    H: 'HMS',
    S: 'ESA',
    R: 'Hoermann',
    A: 'AskSin',
    V: 'MORITZ',
    Z: 'MORITZ',
    o: 'Obis',
    t: 'TX',
    U: 'Uniroll',
    i: 'IT',
    K: 'WS'
};

const modes = {
    slowrf: {
    },
    moritz: {
        start: 'Zr',
        stop: 'Zx'
    },
    asksin: {
        start: 'Ar',
        stop: 'Ax'
    }
};

const Cul = function (options) {
    const that = this;
    options = options || {};
    options.initCmd = 0x01;
    options.mode = options.mode || 'SlowRF';
    options.init = options.init || true;
    options.parse = options.parse || true;
    options.coc = options.coc || false;
    options.scc = options.scc || false;
    options.rssi = options.rssi || true;
    options.debug = options.debug || false;
    options.repeat = options.repeat || false;
    options.connectionMode = options.connectionMode || 'serial';
    options.networkTimeout = options.networkTimeout || true;
    options.logger = options.logger || console.log;
    options.transmitterList = options.transmitterList || [1];

    if (options.coc) {
        options.baudrate = options.baudrate || 38400;
        options.serialport = options.serialport || '/dev/ttyACM0';
    } else if (options.scc) {
        options.baudrate = options.baudrate || 38400;
        options.serialport = options.serialport || '/dev/ttyAMA0';
    } else {
        options.baudrate = options.baudrate || 9600;
        options.serialport = options.serialport || '/dev/ttyAMA0';
    }

    if (options.rssi) {
        // Set flag, binary or
        options.initCmd |= 0x20;
    }

    if (options.repeat) {
        // Set flag, binary or
        options.initCmd |= 0x02;
    }

    options.initCmd = 'X' + ('0' + options.initCmd.toString(16)).slice(-2);

    const modeCmd = modes[options.mode.toLowerCase()] ? modes[options.mode.toLowerCase()].start : undefined;
    let stopCmd;

    if (modes[options.mode.toLowerCase()] && modes[options.mode.toLowerCase()].stop) {
        stopCmd = modes[options.mode.toLowerCase()].stop;
    }

    // Serial connection
    if (options.connectionMode === 'serial') {

        const { SerialPort } = require('serialport');
        const { ReadlineParser } = require('@serialport/parser-readline')

        const parser = new ReadlineParser({ delimiter: '\r\n' });

        const serialPort = new SerialPort({path: options.serialport, 
                                           baudRate: Number(options.baudrate),
                                           lock: false});

        serialPort.pipe(parser);

        this.close = function (callback) {
            if (!serialPort.isOpen) {
                return;
            }

            if (options.init && stopCmd) {
                that.write(stopCmd, 0, () => {
                    serialPort.close(callback);
                });
            } else {
                serialPort.close(callback);
            }
        };

        serialPort.on('close', () => {
            that.emit('close');
        });

        serialPort.on('open', () => {
            if (options.init) {
                setTimeout(() => { // Give CUL enough time to wakeup
                    that.write(options.initCmd, 1, err => {
                        if (err) {
                            that.emit('error', err);
                        }
                    });
                    serialPort.drain(() => {
                        if (modeCmd) {
                            that.write(modeCmd, 1, err => {
                                if (err) {
                                    that.emit('error', err);
                                }
                            });
                            serialPort.drain(err => {
                                if (err) {
                                    that.emit('error', err);
                                } else {
                                    ready();
                                }
                            });
                        } else {
                            initStackedCULs();
                            ready();
                        }
                    });
                }, 2000);
            } else {
                ready();
            }

            function initStackedCULs() {
                for(let Index=1; Index < options.transmitterList.length; Index++) {
                    let culNo = options.transmitterList[Index];

                    that.write(options.initCmd, culNo, err => {
                        if (err) {
                            that.emit('error', err);
                        }
                    });
                }
            }

            function ready() {
                parser.on('data', parse);
                that.emit('ready');
            }
        });

        serialPort.on('error', ex => {
            that.emit('error', ex);
        });

        this.write = function (data, transmitterNo, callback) {
            if (options.debug) {
                options.logger('transmitter number -> ' + transmitterNo);
                options.logger('data ->' + data);
            }

            if(transmitterNo === 1) {
                serialPort.write(data + '\r\n');
            } else {

                let stackPrefix = getStackPrefix(transmitterNo);
                let stackedData = stackPrefix + data;
                options.logger('stackedData ->' + stackedData);
                serialPort.write(stackedData + '\r\n');
            }

            serialPort.drain(callback);
        };
    } else if (options.connectionMode === 'telnet') {
        // Telnet connection
        const net = require('net');

        if (!options.host) {
            throw new Error('no host defined!');
        }

        options.port = options.port || '2323';

        const telnet = net.createConnection(Number.parseInt(options.port, 10), options.host);

        if (options.networkTimeout) {
            // WATCHDOG
            this.telnetWatchdog = Date.now(); // Setup watchdog
            this.telnetWatchdogSecondTry = false; // We try to times before the watchdog bites
            setInterval(() => {
                if (Date.now() - that.telnetWatchdog > 5000) { // Watchdog bites
                    if (that.telnetWatchdogSecondTry) { // Second time
                        // the answer to the command we have written has not arrived
                        // so we throw an error
                        that.emit('error', new Error('Connection Timeout!'));
                    } else { // First time
                        // if its the first time we are writing a
                        // simple command to the server and wait for an answer
                        that.telnetWatchdogSecondTry = true;
                        that.telnetWatchdog = Date.now();
                        that.write('V');
                    }
                }
            }, 2500);

            this.patWatchdog = function () {
                that.telnetWatchdog = Date.now(); // Save new time
                that.telnetWatchdogSecondTry = false;
            };
        }

        telnet.on('connect', () => {
            options.logger('Connected');

            if (options.init) {
                that.write(options.initCmd);

                if (modeCmd) {
                    that.write(modeCmd);
                }
            }

            telnet.on('data', data => {
                data.toString().split(/\r?\n/).forEach(parse);
                that.patWatchdog(); // Pat Watchdog
            });

            that.emit('ready');
        });

        telnet.on('close', () => {
            options.logger('Disconnected');
            that.emit('close');
        });

        telnet.on('error', ex => {
            that.emit('error', ex);
        });

        this.write = function (data, dummy, callback) {
            if (options.debug) {
                options.logger('->' + data);
            }

            telnet.write(data + '\r\n');

            if (callback) {
                callback(false);
            }
        };
    } else {
        // If an unknown connection is defined
        throw new Error('connection mode \'' + options.connectionMode + '\' is unknown!\nplease use \'serial\' or \'telnet\'');
    }

    this.cmd = function () {
        let args = Array.prototype.slice.call(arguments);

        let callback;        
        if (typeof args[args.length - 1] === 'function') {
            callback = args.pop();
        }

        let transmitter = 1;
        if (typeof args[args.length - 1] === 'object') {
            let argObject = args.pop();
            transmitter = argObject.transmitter;
        }

        let c = args[0].toLowerCase();
        args = args.slice(1);

        if (commands[c.toUpperCase()]) {
            c = commands[c.toUpperCase()].toLowerCase();
        }

        if (protocol[c] && typeof protocol[c].cmd === 'function') {
            const message = protocol[c].cmd.apply(null, args);
            if (message) {
                that.write(message, transmitter ,callback);
                return true;
            }

            if (typeof callback === 'function') {
                callback('cmd ' + c + ' ' + JSON.stringify(args) + ' failed');
            }

            return false;
        }

        if (typeof callback === 'function') {
            callback('cmd ' + c + ' not implemented');
        }

        return false;
    };

    function parse(data) {
        if (!data) {
            return;
        }

        data = data.toString();

        let message;
        let command;
        let p;
        let rssi;
        let dataRaw;
        let transmitterNumber = 1;

        if (options.parse) {
            if (options.transmitterList.length > 1) {

                transmitterNumber = getTransmitterNumber(data);
                data = data.slice(transmitterNumber-1);        // remove leading *
            }

            if (options.rssi) {
                dataRaw = data.slice(0,-2); // remove RSSI byte
            } else {
                dataRaw = data;
            }

            command = dataRaw[0];

            message = {};
            if (commands[command]) {
                p = commands[command].toLowerCase();
                if (protocol[p] && typeof protocol[p].parse === 'function') {
                    message = protocol[p].parse(dataRaw);

                    message.data.transmitter = transmitterNumber;
                }
            }

            if (options.rssi) {
                rssi = Number.parseInt(data.slice(-2), 16);
                message.rssi = (rssi >= 128 ? (((rssi - 256) / 2) - 74) : ((rssi / 2) - 74));
            }
        }

        that.emit('data', data, message);
    }

    function getStackPrefix(transmitterNo) {
        switch(transmitterNo) {
            case 2: return '*';
            case 3: return '**';
            case 4: return '***';
            default: return '';
        }
    }

    function getTransmitterNumber(data) {
        let number = 1;

        for(let i = 0; i < data.length; i++) {
            if(data[i] === '*') {
                number++;
            }
            else
                return number;
        }
        return number;
    }

    return this;
};

util.inherits(Cul, EventEmitter);

module.exports = Cul;
//# sourceMappingURL=chgcul.js.map