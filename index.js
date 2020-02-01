const fetch = require('node-fetch');
const sockjs = require('sockjs-client');
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-octoprint-motion", "octoprint", octoprint, true);
}

function octoprint(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = [];
    this.timers = {};

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

octoprint.prototype.configureAccessory = function(accessory) {
    this.getInitState(accessory);
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
    var body = {};
    body.passive = true;
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
                octo.send(JSON.stringify(msg));
            };

            octo.onmessage = e => {
                var state;
                if (e.data.history) {
                    state = e.data.history.state;
                } else if (e.data.current) {
                    state = e.data.current.state;
                } else {
                    return;
                }

                accessory.getService(Service.MotionSensor)
                    .setCharacteristic(Characteristic.MotionDetected, state.flags.printing)
                    .setCharacteristic(Characteristic.StatusActive, state.flags.ready)
                    .setCharacteristic(Characteristic.StatusLowBattery, state.flags.error);
            };

            octo.onclose = () => {
                this.log(accessory.context.config.name + ' SockJS Connection Closed');
                setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
            };
        })
        .catch(error => {
            accessory.getService(Service.MotionSensor)
                .setCharacteristic(Characteristic.MotionDetected, false)
                .setCharacteristic(Characteristic.StatusActive, false)
                .setCharacteristic(Characteristic.StatusLowBattery, true)
            setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
        });
}

octoprint.prototype.addAccessory = function(data) {
    this.log("Initializing platform accessory '" + data.name + "'...");

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

        this.api.registerPlatformAccessories("homebridge-octoprint-motion", "octoprint", [accessory]);

        this.accessories.push(accessory);

        this.getInitState(accessory);
    } else {
        accessory.context.config = data;
    }
}

octoprint.prototype.getInitState = function(accessory) {
    accessory.on('identify', (paired, callback) => {
        this.log(accessory.displayName, "identify requested!");
        callback();
    });
    accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected)
        .on('get', callback => {
            this.fetchStatus(accessory);
            callback();
        });

    var manufacturer = accessory.context.config.manufacturer || "Gina Häußge";
    var model = accessory.context.config.model || "OctoPrint";
    var serial = accessory.context.config.serial || accessory.context.config.url;
    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial);

    accessory.updateReachability(true);
}

octoprint.prototype.removeAccessories = function(accessories) {
    accessories.forEach(accessory => {
        this.api.unregisterPlatformAccessories("homebridge-octoprint-motion", "octoprint", [accessory]);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
}

octoprint.prototype.identify = function(accessory, paired, callback) {
    this.log(accessory.context.config.name + "identify requested!");
    callback();
}