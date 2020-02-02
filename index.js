const fetch = require('node-fetch');
const sockjs = require('sockjs-client');
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-octoprint-motion', 'octoprint', octoprint, true);
}

function octoprint(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = [];

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

octoprint.prototype.configureAccessory = function(accessory) {
    if (accessory.getService(Service.BatteryService) == null) {
        accessory.addService(Service.BatteryService, accessory.context.config.name);
    }
    this.accessories.push(accessory);
}

octoprint.prototype.didFinishLaunching = function() {
    var urls = [];
    this.config.instances.forEach(instance => {
        this.addAccessory(instance);
        urls.push(instance.url);
    });

    var badAccessories = [];
    this.accessories.forEach(cachedAccessory => {
        if (!urls.includes(cachedAccessory.context.config.url)) {
            badAccessories.push(cachedAccessory);
        }
    });
    this.removeAccessories(badAccessories);

    this.accessories.forEach(accessory => this.startSockJS(accessory));
}

octoprint.prototype.startSockJS = function(accessory) {
    var body = {
        passive: true
    };
    fetch(accessory.context.config.url + '/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': accessory.context.config.api_key
            },
            body: JSON.stringify(body)
        })
        .then(res => res.json())
        .then(json => {
            var msg = {};
            msg.auth = json.name + ':' + json.session;
            var octo = new sockjs(accessory.context.config.url + '/sockjs/');

            octo.onopen = () => {
                this.log(accessory.context.config.name + ' SockJS Connection Opened');
                octo.send(JSON.stringify(msg));
            };

            octo.onmessage = msg => {
                var payload;
                if (msg.data.connected) {
                    accessory.getService(Service.AccessoryInformation)
                        .setCharacteristic(Characteristic.FirmwareRevision, msg.data.connected.version);
                    return;
                } else if (msg.data.current) {
                    payload = msg.data.current;
                } else if (msg.data.history) {
                    payload = msg.data.history;
                } else {
                    return;
                }

                var active = payload.state.flags.ready || payload.state.flags.printing;

                if (accessory.context.config.case_light) {
                    var regex = /Send: M355 S(?<S>\d+)(?: P(?<P>\d+))?/gis;

                    payload.logs.forEach(logEntry => {
                        var result = regex.exec(logEntry);
                        if (result) {
                            var light = accessory.getService(Service.Lightbulb);
                            if (result.groups.S) {
                                light.updateCharacteristic(Characteristic.On, result.groups.S);
                            }
                            if (result.groups.P) {
                                light.updateCharacteristic(Characteristic.Brightness, result.groups.P / 255 * 100);
                            }
                        }
                    });

                    var wasActive = accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.StatusActive).value;
                    if (wasActive && !active) {
                        accessory.getService(Service.Lightbulb)
                            .updateCharacteristic(Characteristic.On, false);
                    } else if (!wasActive && active) {
                        accessory.getService(Service.Lightbulb)
                            .updateCharacteristic(Characteristic.On, true);
                    }
                }

                accessory.getService(Service.MotionSensor)
                    .updateCharacteristic(Characteristic.MotionDetected, payload.state.flags.printing)
                    .updateCharacteristic(Characteristic.StatusActive, active)
                    .updateCharacteristic(Characteristic.StatusLowBattery, payload.state.flags.error);

                accessory.getService(Service.BatteryService)
                    .updateCharacteristic(Characteristic.BatteryLevel, (payload.progress.completion == null) ? 100 : payload.progress.completion)
                    .updateCharacteristic(Characteristic.ChargingState, ((payload.progress.completion != null) && !payload.state.flags.paused) ? 1 : 0)
                    .updateCharacteristic(Characteristic.StatusLowBattery, false);
            };

            octo.onclose = () => {
                this.log(accessory.context.config.name + ' SockJS Connection Closed');
                accessory.getService(Service.MotionSensor)
                    .updateCharacteristic(Characteristic.MotionDetected, false)
                    .updateCharacteristic(Characteristic.StatusActive, false)
                    .updateCharacteristic(Characteristic.StatusLowBattery, true);

                accessory.getService(Service.BatteryService)
                    .updateCharacteristic(Characteristic.BatteryLevel, 0)
                    .updateCharacteristic(Characteristic.ChargingState, 0)
                    .updateCharacteristic(Characteristic.StatusLowBattery, true);

                if (accessory.context.config.case_light) {
                    accessory.getService(Service.Lightbulb)
                        .updateCharacteristic(Characteristic.On, false);
                }

                setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
            };
        })
        .catch(error => {
            accessory.getService(Service.MotionSensor)
                .updateCharacteristic(Characteristic.MotionDetected, false)
                .updateCharacteristic(Characteristic.StatusActive, false)
                .updateCharacteristic(Characteristic.StatusLowBattery, true);

            accessory.getService(Service.BatteryService)
                .updateCharacteristic(Characteristic.BatteryLevel, 0)
                .updateCharacteristic(Characteristic.ChargingState, 0)
                .updateCharacteristic(Characteristic.StatusLowBattery, true);

            if (accessory.context.config.case_light) {
                accessory.getService(Service.Lightbulb)
                    .updateCharacteristic(Characteristic.On, false);
            }

            setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
        });
}

octoprint.prototype.setCaseLight = function(accessory, state, callback) {
    var body = {
        command: 'M355 S'
    };
    if (state > 0) {
        body.command += '1 P' + Math.round(state * 2.55);
    } else {
        body.command += '0';
    }
    fetch(accessory.context.config.url + '/api/printer/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': accessory.context.config.api_key
            },
            body: JSON.stringify(body)
        })
        .then(res => {
            if (res.ok) {
                callback();
            } else {
                callback(res.statusText)
            }
        })
        .catch(error => callback(error));
}

octoprint.prototype.setCaseLightToggle = function(accessory, state, callback) {
    var on = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value;
    if (state && !on) {
        var light = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).value;
        this.setCaseLight(accessory, light, callback);
    } else if (!state && on) {
        this.setCaseLight(accessory, 0, callback);
    } else {
        callback();
    }
}

octoprint.prototype.addAccessory = function(data) {
    this.log('Initializing platform accessory ' + data.name + '...');

    var accessory;
    this.accessories.forEach(cachedAccessory => {
        if (cachedAccessory.context.config.url == data.url) {
            accessory = cachedAccessory;
        }
    });

    if (!accessory) {
        var uuid = UUIDGen.generate(data.url);

        accessory = new Accessory(data.name, uuid);

        accessory.context.config = data;

        accessory.addService(Service.MotionSensor, data.name);
        accessory.addService(Service.BatteryService, data.name);

        this.api.registerPlatformAccessories('homebridge-octoprint-motion', 'octoprint', [accessory]);

        this.accessories.push(accessory);

        this.getInitState(accessory);
    } else {
        accessory.context.config = data;

        this.getInitState(accessory);
    }
}

octoprint.prototype.getInitState = function(accessory) {
    accessory.on('identify', (paired, callback) => {
        this.log(accessory.context.config.name + ' identify requested!');
        callback();
    });

    var manufacturer = accessory.context.config.manufacturer || 'Gina Häußge';
    var model = accessory.context.config.model || 'OctoPrint';
    var serial = accessory.context.config.serial || accessory.context.config.url;
    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial);

    accessory.context.config.case_light = accessory.context.config.case_light || false;

    var light = accessory.getService(Service.Lightbulb);
    if (light != undefined && !accessory.context.config.case_light) {
        accessory.removeService(light);
    } else if (light == undefined && accessory.context.config.case_light) {
        accessory.addService(Service.Lightbulb, accessory.context.config.name)
            .addCharacteristic(Characteristic.Brightness);
    }

    if (light) {
        light.getCharacteristic(Characteristic.Brightness)
            .on('set', this.setCaseLight.bind(this, accessory))
            .updateValue(100);
        light.getCharacteristic(Characteristic.On)
            .on('set', this.setCaseLightToggle.bind(this, accessory))
            .updateValue(true);
    }

    accessory.updateReachability(true);
}

octoprint.prototype.removeAccessories = function(accessories) {
    accessories.forEach(accessory => {
        this.api.unregisterPlatformAccessories('homebridge-octoprint-motion', 'octoprint', [accessory]);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
}

octoprint.prototype.identify = function(accessory, paired, callback) {
    this.log(accessory.context.config.name + 'identify requested!');
    callback();
}