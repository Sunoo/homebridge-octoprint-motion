const fetch = require('node-fetch');
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
    
    this.accessories.forEach(accessory => this.fetchStatus(accessory));
}

octoprint.prototype.fetchStatus = function(accessory) {
    if (this.timers[accessory.context.config.url]) {
        clearTimeout(this.timers[accessory.context.config.url]);
        this.timers[accessory.context.config.url] = null;
    }

    fetch(accessory.context.config.url + '/api/printer', {
            headers: {
                'X-Api-Key': this.apiKey
            }
        })
        .then(res => {
            if (res.ok) {
                return res.json();
            } else {
                var json = {};
                json.state = {};
                json.state.flags = {};
                json.state.flags.printing = false;
                json.state.flags.error = true;
                return json;
            }
        })
        .then(json => {
            accessory.context.flags = json.state.flags;
            accessory.getService(Service.MotionSensor)
                .setCharacteristic(Characteristic.MotionDetected, accessory.context.flags.printing)
                .setCharacteristic(Characteristic.StatusActive, !accessory.context.flags.error)
                .setCharacteristic(Characteristic.StatusLowBattery, false);
        })
        .catch(error => {
            accessory.context.flags = {};
            accessory.getService(Service.MotionSensor)
                .setCharacteristic(Characteristic.MotionDetected, false)
                .setCharacteristic(Characteristic.StatusActive, false)
                .setCharacteristic(Characteristic.StatusLowBattery, true);
        })
        .finally(function() {
            if (this.config.polling_seconds > 0) {
                this.timers[accessory.context.config.url] = setTimeout(this.fetchStatus.bind(this, accessory),
                    this.config.polling_seconds * 1000);
            }
        }.bind(this));
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
    this.log(accessory.context.name + "identify requested!");
    callback();
}