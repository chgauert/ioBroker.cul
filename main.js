/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */

'use strict';
const Main = require('cul');
//const Main = require('./lib/chgcul.js')
const adapterName = require('./package.json').name.split('.').pop();

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils

let cul;
const objects   = {};
let metaRoles = {};
let SerialPort;
let Net;
let connectTimeout;
let checkConnectionTimer;

try {
    Net = require('net');
} catch (e) {
    console.warn('Net is not available');
}

//
// read state transmitter from parent object
//   return transmitter from parent object or default value 1
//
async function getTransmitterFromObject(id) {

    const oParts = id.split('.');
    if (oParts.length < 5) {
        adapter.log.error('Invalid id used');
        return 1;
    }

    let cmd = oParts[4];

    let idTransmitter = id.slice(0, id.length-cmd.length) + 'transmitter';

    let result = await adapter.getStateAsync(idTransmitter);

    if(result !== "undefined") {
        return result.val;
    } else {
        return 1;
    }
}

let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});
    adapter = new utils.Adapter(options);

    adapter.on('stateChange', async (id, state) => {
        if (state && !state.ack) {
            adapter.log.debug(`State Change ${JSON.stringify(id)}, State: ${JSON.stringify(state)}`);

            const oAddr = id.split('.');
            if (oAddr.length < 5) {
                adapter.log.error('Invalid id used');
                return;
            }
            // get used transmitter
            let transmitter = await getTransmitterFromObject(id);

            if (oAddr[2] === 'FS20' || adapter.config.experimental === true || adapter.config.experimental === 'true') {
                // State Change 
                //   id    = "cul.0.FS20.123401.cmd"     
                //   state = {"val":2,"ack":false,"ts":1581365531968,"q":0,"from":"system.adapter.admin.0","user":"system.user.admin","lc":1581365531968}
                //
                // State change object -> 
                // 0: cul; 
                // 1: 0; 
                // 2: FS20; 
                // 3: 123401; 
                // 4: cmd;
                const sHousecode = oAddr[3].substring(0, 4);
                const sAddress = oAddr[3].substring(4, 6);
            
                switch (oAddr[4]) {
                    case 'cmdRaw':
                        sendCommand({protocol: oAddr[2], housecode: sHousecode, address: sAddress, command: state.val, transmitter: transmitter});
                        break;

                    default:
                        adapter.log.error(`Write of State ${oAddr[4]} currently not implemented`);
                        break;
                }
            } else if (oAddr[2] === 'IT') {
                // State change
                //  id    = "cul.0.IT.1101100000101000000000000000010.command"
                //  state = 
                //
                // State change object -> 
                // 0: cul
                // 1: 0 
                // 2: IT
                // 3: 1101100000101000000000000000010
                // 4: command  oder dimLevel
                const sAddress = oAddr[3];
            
                switch (oAddr[4]) {
                    case 'command':
                        sendCommand({protocol: oAddr[2], address: sAddress, command: state.val, transmitter: transmitter});
                        break;
                    case 'dimLevel':
                        sendCommand({protocol: oAddr[2], address: sAddress, dimLevel: state.val, transmitter: transmitter});
                        break;                        
                    default:
                        adapter.log.error(`Write of State ${oAddr[4]} currently not implemented`);
                        break;
                }
            } else {
                adapter.log.error('Only FS20 and IT Devices are tested. Please contribute here: https://github.com/ioBroker/ioBroker.cul');
            }
        }
    });

    adapter.on('unload', callback => {
        connectTimeout && clearTimeout(connectTimeout);
        connectTimeout = null;

        checkConnectionTimer && clearTimeout(checkConnectionTimer);
        checkConnectionTimer = null;

        if (cul) {
            try {
                cul.close();
                cul = null;
            } catch (e) {
                adapter.log.error(`Cannot close serial port: ${e.toString()}`);
            }
        }
        callback();
    });

    adapter.on('ready', () => {

        try {
            SerialPort = require('serialport').SerialPort;
        } catch (err) {
            console.warn('Serial port is not available');
            if (adapter.supportsFeature && !adapter.supportsFeature('CONTROLLER_NPM_AUTO_REBUILD')) {
                // re throw error to allow rebuild of serialport in js-controller 3.0.18+
                throw err;
            }
        }

        adapter.setState('info.connection', false, true);

        checkPort(err => {
            if (!err || process.env.DEBUG) {
                main();
            } else {
                adapter.log.error(`Cannot open port: ${err}`);
            }
        });
    });

    adapter.on('message', obj => {
        if (obj) {
            switch (obj.command) {
                case 'listUart':
                    if (obj.callback) {
                        if (SerialPort) {
                            // read all found serial ports
                            SerialPort.list().then(ports => {
                                adapter.log.info(`List of port: ${JSON.stringify(ports)}`);
                                //adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                                adapter.sendTo(obj.from, obj.command, ports.map(item => ({
                                    label: item.friendlyName || item.pnpId || item.manufacturer,
                                    id: item.pnpId,
                                    manufacturer: item.manufacturer,
                                    comName: item.path
                                })), obj.callback);
                            }).catch(err => {
                                adapter.log.warn(`Can not get Serial port list: ${err}`);
                                adapter.sendTo(obj.from, obj.command, [{path: 'Not available'}], obj.callback);
                            });
                        } else {
                            adapter.log.warn('Module serialport is not available');
                            adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                        }
                    }
                    break;

                case 'listUart5':
                    if (obj.callback) {
                        try {
                            if (SerialPort) {
                                // read all found serial ports
                                SerialPort.list()
                                    .then(ports => {
                                        adapter.log.info(`List of port: ${JSON.stringify(ports)}`);
                                        if (obj.message && obj.message.experimental) {
                                            const dirSerial = '/dev/serial/by-id';
                                            adapter.sendTo(obj.from, obj.command, ports.map(item => ({label: `${dirSerial}/${item.id}${item.manufacturer ? `[${item.manufacturer}]` : ''}`, value: `${dirSerial}/${item.id}`})), obj.callback);
                                        } else {
                                            adapter.sendTo(obj.from, obj.command, ports.map(item => ({label: item.path, value: item.path})), obj.callback);
                                        }
                                    })
                                    .catch(e => {
                                        adapter.sendTo(obj.from, obj.command, [], obj.callback);
                                        adapter.log.error(e)
                                    });
                            } else {
                                adapter.log.warn('Module serialport is not available');
                                adapter.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                            }
                        } catch (e) {
                            adapter.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                        }
                    }
                    break;

                case 'send':
                    sendCommand({
                        protocol: obj.message.protocol,
                        housecode: obj.message.housecode,
                        address: obj.message.address,
                        command: obj.message.command,
                        dimLevel: obj.message.dimLevel,
                        transmitter: obj.message.transmitter
                    });
                    break;

                case 'sendraw':
                    sendRaw({
                        command: obj.message.command,
                        transmitter: obj.message.transmitter
                    });
                    break;

                default:
                    adapter.log.error('No such command: ' + obj.command);
                    break;
            }
        }
    });

    return adapter;
}

/***
 * Send a command to the cul module
 * @param {obj.message.protocol, obj.message.housecode, obj.message.address, obj.message.command}
 * @param {obj.message.protocol, obj.message.address, obj.message.command}
 */
function sendCommand(o) {

    adapter.log.info(`Send command received. Housecode: ${o.housecode}; address: ${o.address}; command: ${o.command}`);

    let transmitter = typeof o.transmitter !== "undefined" ? o.transmitter : 1;
    
    cul.cmd(o.protocol, 
            o.housecode, 
            o.address, 
            o.command, 
            o.dimLevel,
            { "transmitter" : transmitter});
}

function sendRaw(o) {

    adapter.log.info('Send RAW command received. command =' + o.command);

    let transmitter = typeof o.transmitter !== "undefined" ? o.transmitter : 1;

	// 1.Param = command
    // 2.Param = transmitter number to write to
    cul.write(o.command, transmitter);
}

function checkConnection(host, port, timeout, callback) {
    timeout = timeout || 10000; // default 10 seconds

    checkConnectionTimer = setTimeout(() => {
        checkConnectionTimer = null;
        socket.end();
        callback && callback('Timeout');
        callback = null;
    }, timeout);

    const socket = Net.createConnection(port, host, () => {
        checkConnectionTimer && clearTimeout(checkConnectionTimer);
        checkConnectionTimer = null;
        socket.end();
        callback && callback(null);
        callback = null;
    });

    socket.on('error', err => {
        checkConnectionTimer && clearTimeout(checkConnectionTimer);
        checkConnectionTimer = null;
        socket.end();
        callback && callback(err);
        callback = null;
    });
}

function checkPort(callback) {
    if (adapter.config.type === 'cuno') {
        checkConnection(adapter.config.ip, adapter.config.port, 10000, err => {
            callback && callback(err);
            callback = null;
        });
    } else {      
        if (!adapter.config.serialport) {
            callback && callback('Port is not selected');
            return;
        }
        let sPort;
        try {
            sPort = new SerialPort({
                path: adapter.config.serialport || '/dev/ttyACM0',
                baudRate: parseInt(adapter.config.baudrate, 10) || 9600,
                autoOpen: false
            });
            sPort.on('error', err => {
                sPort.isOpen && sPort.close();
                callback && callback(err);
                callback = null;
            });

            sPort.open(err => {
                sPort.isOpen && sPort.close();
                callback && callback(err);
                callback = null;
            });
        } catch (e) {
            adapter.log.error('Cannot open port: ' + e);
            try {
                sPort.isOpen && sPort.close();
            } catch (ee) {

            }
            callback && callback(e);
        }
    }
}

const tasks = [];

function processTasks() {
    if (tasks.length) {
        const task = tasks.shift();

        if (task.type === 'state') {
            adapter.setForeignState(task.id, task.val, true, () =>
                setImmediate(processTasks));
        } else if (task.type === 'object') {
            adapter.getForeignObject(task.id, (err, obj) => {
                if (!obj) {
                    adapter.setForeignObject(task.id, task.obj, (err, res) => {
                        adapter.log.info(`object ${adapter.namespace}.${task.id} created`);
                        setImmediate(processTasks);
                    });
                } else {
                    let changed = false;
                    if (JSON.stringify(obj.native) !== JSON.stringify(task.obj.native)) {
                        obj.native = task.obj.native;
                        changed = true;
                    }

                    if (changed) {
                        adapter.setForeignObject(obj._id, obj, (err, res) => {
                            adapter.log.info(`object ${adapter.namespace}.${obj._id} created`);
                            setImmediate(processTasks);
                        });
                    } else {
                        setImmediate(processTasks);
                    }
                }
            });
        }
    }
}

function setStates(obj) {
    const id = obj.protocol + '.' + obj.address;
    const isStart = !tasks.length;

    for (const state in obj.data) {
        if (!obj.data.hasOwnProperty(state)) {
            continue;
        }    

        const oid  = `${adapter.namespace}.${id}.${state}`;
        const meta = objects[oid];
        let val  = obj.data[state];
        if (meta) {
            if (meta.common.type === 'boolean') {
                val = val === 'true' || val === true || val === 1 || val === '1' || val === 'on';
            } else if (meta.common.type === 'number') {
                if (val === 'on'  || val === 'true'  || val === true)  val = 1;
                if (val === 'off' || val === 'false' || val === false) val = 0;
                val = parseFloat(val);
            }
        }
        tasks.push({type: 'state', id: oid, val: val});
    }
    isStart && processTasks();
}

function setTransmitterObjectData(transmitterList) {

    for(let i=0; i < transmitterList.length; i++) {

        let number = transmitterList[i];

        let nameTransmitterObject = "Transmitter" + number;
        let configObjectName = "sc" + number + "Name";

        let name = adapter.config[configObjectName];
        if(name && name !== '') {
            if( number === 1) {
                adapter.setState(nameTransmitterObject + ".name", name, true);
                adapter.setState(nameTransmitterObject + ".number", number, true);
            } else {                
                createStackedTransmitterObject(nameTransmitterObject);

                adapter.setState(nameTransmitterObject + ".name", name, true);
                adapter.setState(nameTransmitterObject + ".number", number, true);
            }
        }

    }
}

function createStackedTransmitterObject(TransmitterObjectName) {

    adapter.setObjectNotExists(TransmitterObjectName, {
        type: "channel",
        common: { name: "Stacked Transmitter" },
        native: {},
    });

    adapter.setObjectNotExists(TransmitterObjectName + ".name", {
        type: "state",
        common: {
            name: "Name",
            type: "string",
            role: "text",
            read: true,
            write: false,
        },
        native: {},
    });      

    adapter.setObjectNotExists(TransmitterObjectName + ".number", {
        type: "state",
        common: {
            name: "Number of Transmitter",
            type: "number",
            role: "value",
            read: true,
            write: false,
        },
        native: {},
    });     

    adapter.setObjectNotExists(TransmitterObjectName + ".rawData", {
        type: "state",
        common: {
            name: "raw data",
            type: "string",
            role: "state",
            read: true,
            write: false,
        },
        native: {},
    });    
}

function removeAllStackedTransmitters(transmitterList) {

    for(let i=0; i < transmitterList.length; i++) {

        let number = transmitterList[i];
        if(number > 1) {
            let nameTransmitterObject = "Transmitter" + number;

            adapter.delObject(nameTransmitterObject, { recursive: true });
        }
    }
}

function createTransmitterList() {

    let result = [];
    result.push(1);     // 1 Transmitter gibt es immer

    if(adapter.config.type == 'stackedcul') {

        for(let i=1; i <= 4; i++)
        {
            let configObjectName = "sc" + i + "Name";

            let name = adapter.config[configObjectName];
            if(name && name !== '') {
                if( i > 1) {
                    result.push(i);
                }
            }
        }   
    }
    return result;
}

function connect(callback) {
    const options = {
        connectionMode: adapter.config.type === 'cuno' ? 'telnet' : 'serial' ,
        serialport: adapter.config.serialport || '/dev/ttyACM0',
        mode:       adapter.config.mode       || 'SlowRF',
        baudrate:   parseInt(adapter.config.baudrate, 10) || 9600,
        scc:        adapter.config.type === 'scc',
        coc:        adapter.config.type === 'coc',
        host:       adapter.config.ip,
        port:       adapter.config.port,
        debug:      true,
        logger:     adapter.log.debug
    };

    options.transmitterList = createTransmitterList();

    cul = new Main(options);

    cul.on('close', () => {
        adapter.setState('info.connection', false, true);
        
        removeAllStackedTransmitters(options.transmitterList);

        connectTimeout = setTimeout(() => {
            connectTimeout = null;
            cul = null;
            connect();
        }, 10000);
    });

    cul.on('ready', () => {
        adapter.setState('info.connection', true, true);

        setTransmitterObjectData(options.transmitterList);

        typeof callback === 'function' && callback();
    });

    cul.on('error', err =>
        adapter.log.error('Error on Cul connection: ' +  err));
   
    cul.on('data', async (raw, obj) => {
        adapter.log.debug(`RAW: ${raw}, ${JSON.stringify(obj)}`);
        
        let Number = ((raw, obj) => {

            let index = 1;

            if(!obj || !obj.data || !obj.data.transmitter) {
                
                for(let i = 0; i < raw.length; i++) {
                    if(raw[i] === '*') {
                        index++;
                    }
                    else
                        return index;
                }
                return index;
            }
            else {
                return obj.data.transmitter;
            }
        })(raw, obj);

        let usedTransmitter = 'Transmitter' + Number;

        adapter.setState(usedTransmitter + '.rawData', raw, true);

        if (!obj || !obj.protocol || (!obj.address && obj.address !== 0)) {
            return;
        }

        const id = obj.protocol + '.' + obj.address;

        let oDevice = await adapter.getObjectAsync(adapter.namespace + '.' + id);
        if(oDevice === null && (adapter.config.autoadd === false || adapter.config.autoadd === 'false')) {
            return;
        }

        const isStart = !tasks.length;
        if (oDevice === null) {  // (!objects[adapter.namespace + '.' + id]) {

            const newObjects = [];
            const tmp = JSON.parse(JSON.stringify(obj));
            delete tmp.data;

            const newDevice = {
                _id:    adapter.namespace + '.' + id,
                type:   'device',
                common: {
                    name: (obj.device ? obj.device + ' ' : '') + obj.address
                },
                native: tmp
            };
            for (const _state in obj.data) {
                if (!obj.data.hasOwnProperty(_state)) continue;
                let common;

                if (obj.device && metaRoles[obj.device + '_' + _state]) {
                    common = JSON.parse(JSON.stringify(metaRoles[obj.device + '_' + _state]));
                } else if (metaRoles[_state]) {
                    common = JSON.parse(JSON.stringify(metaRoles[_state]));
                } else {
                    common = JSON.parse(JSON.stringify(metaRoles['undefined']));
                }

                common.name = _state + ' ' + (obj.device ? obj.device + ' ' : '') + id;

                const newState = {
                    _id:    `${adapter.namespace}.${id}.${_state}`,
                    type:   'state',
                    common: common,
                    native: {}
                };

                //objects[`${adapter.namespace}.${id}.${_state}`] = newState;
                tasks.push({type: 'object', id: newState._id, obj: newState});
            }
            //objects[adapter.namespace + '.' + id] = newDevice;
            tasks.push({type: 'object', id: newDevice._id, obj: newDevice});
        }
        setStates(obj);
        isStart && processTasks();
    });
    
}

function main() {
    adapter.getForeignObject('cul.meta.roles', (err, res) => {
        if (err || !res) {
            adapter.log.error(`Object cul.meta.roles does not exists - please reinstall adapter! (${err})`);
            typeof adapter.terminate === 'function' ? adapter.terminate(11) : process.exit(11);
            return;
        }
        metaRoles = res.native;
        adapter.getObjectView('system', 'device', {startkey: adapter.namespace + '.', endkey: adapter.namespace + '.\u9999'}, (err, res) => {
            for (let i = 0, l = res.rows.length; i < l; i++) {
                objects[res.rows[i].id] = res.rows[i].value;
            }
            adapter.getObjectView('system', 'state', {startkey: adapter.namespace + '.', endkey: adapter.namespace + '.\u9999'}, (err, res) => {
                for (let i = 0, l = res.rows.length; i < l; i++) {
                    objects[res.rows[i].id] = res.rows[i].value;
                }

                connect(() => adapter.subscribeStates('*'));
            });
        });
    });
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
//# sourceMappingURL=main.js.map
