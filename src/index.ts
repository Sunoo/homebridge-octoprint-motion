import {
  API,
  APIEvent,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
  Service
} from 'homebridge';
import fetch from 'node-fetch';
import sockjs from 'sockjs-client';
import { OctoprintPlatformConfig, InstanceConfig } from './configTypes';

let hap: HAP;
let Accessory: typeof PlatformAccessory;

const PLUGIN_NAME = 'homebridge-octoprint-motion';
const PLATFORM_NAME = 'octoprint';

class OctoprintPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: OctoprintPlatformConfig;
  private readonly accessories: Array<PlatformAccessory>;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config as unknown as OctoprintPlatformConfig;
    this.api = api;
    this.accessories = [];

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    if (accessory.getService(hap.Service.BatteryService) == null) {
      accessory.addService(hap.Service.BatteryService, accessory.context.config.name);
    }
    this.accessories.push(accessory);
  }

  didFinishLaunching(): void {
    const urls: Array<string> = [];
    this.config.instances.forEach((instance: InstanceConfig) => {
      this.addAccessory(instance);
      urls.push(instance.url);
    });

    const badAccessories = this.accessories.filter((cachedAccessory: PlatformAccessory) => {
      return !urls.includes(cachedAccessory.context.config.url);
    });
    this.removeAccessories(badAccessories);

    this.accessories.forEach(accessory => this.startSockJS(accessory));
  }

  startSockJS(accessory: PlatformAccessory): void {
    let sensor: Service | undefined;
    let detected: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (accessory.context.config.occupancy_sensor) {
      sensor = accessory.getService(hap.Service.OccupancySensor);
      detected = hap.Characteristic.OccupancyDetected;
    } else {
      sensor = accessory.getService(hap.Service.MotionSensor);
      detected = hap.Characteristic.MotionDetected;
    }

    const body = {
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
        const msg = {
          auth: json.name + ':' + json.session
        };
        const octo = new sockjs(accessory.context.config.url + '/sockjs/');

        octo.onopen = (): void => {
          this.log(accessory.context.config.name + ' SockJS Connection Opened');
          octo.send(JSON.stringify(msg));
        };

        octo.onmessage = (msg: MessageEvent): void => {
          let payload;
          if (msg.data.connected) {
            const accInfo = accessory.getService(hap.Service.AccessoryInformation);
            if (accInfo) {
              accInfo.setCharacteristic(hap.Characteristic.FirmwareRevision, msg.data.connected.version);
            }
            return;
          } else if (msg.data.current) {
            payload = msg.data.current;
          } else if (msg.data.history) {
            payload = msg.data.history;
          } else {
            return;
          }

          const active = payload.state.flags.ready || payload.state.flags.printing;

          if (accessory.context.config.case_light) {
            const regex = /Send: M355 S(?<S>\d+)(?: P(?<P>\d+))?/gis;

            payload.logs.forEach((logEntry: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
              const result = regex.exec(logEntry);
              if (result?.groups) {
                this.log.warn(JSON.stringify(result));
                const light = accessory.getService(hap.Service.Lightbulb);
                if (light) {
                  if (result.groups.S) {
                    light.updateCharacteristic(hap.Characteristic.On, result.groups.S);
                  }
                  if (result.groups.P) {
                    light.updateCharacteristic(hap.Characteristic.Brightness, parseInt(result.groups.P) / 255 * 100);
                  }
                }
              }
            });
          }

          if (sensor) {
            sensor
              .updateCharacteristic(detected, payload.state.flags.printing)
              .updateCharacteristic(hap.Characteristic.StatusActive, active)
              .updateCharacteristic(hap.Characteristic.StatusLowBattery, payload.state.flags.error || payload.state.flags.closedOrError);
          }

          const battery = accessory.getService(hap.Service.BatteryService);
          if (battery) {
            battery
              .updateCharacteristic(hap.Characteristic.BatteryLevel, payload.progress.completion == null ? 100 : payload.progress.completion)
              .updateCharacteristic(hap.Characteristic.ChargingState, payload.progress.completion != null && !payload.state.flags.paused ? 1 : 0)
              .updateCharacteristic(hap.Characteristic.StatusLowBattery, false);
          }
        };

        octo.onclose = (): void => {
          this.log(accessory.context.config.name + ' SockJS Connection Closed');
          if (sensor) {
            sensor
              .updateCharacteristic(detected, false)
              .updateCharacteristic(hap.Characteristic.StatusActive, false)
              .updateCharacteristic(hap.Characteristic.StatusLowBattery, true);
          }

          const battery = accessory.getService(hap.Service.BatteryService);
          if (battery) {
            battery
              .updateCharacteristic(hap.Characteristic.BatteryLevel, 0)
              .updateCharacteristic(hap.Characteristic.ChargingState, 0)
              .updateCharacteristic(hap.Characteristic.StatusLowBattery, true);
          }

          if (accessory.context.config.case_light) {
            const light = accessory.getService(hap.Service.Lightbulb);
            if (light) {
              light.updateCharacteristic(hap.Characteristic.On, false);
            }
          }

          setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
        };
      })
      .catch((): void => {
        if (sensor) {
          sensor
            .updateCharacteristic(detected, false)
            .updateCharacteristic(hap.Characteristic.StatusActive, false)
            .updateCharacteristic(hap.Characteristic.StatusLowBattery, true);
        }

        const battery = accessory.getService(hap.Service.BatteryService);
        if (battery) {
          battery
            .updateCharacteristic(hap.Characteristic.BatteryLevel, 0)
            .updateCharacteristic(hap.Characteristic.ChargingState, 0)
            .updateCharacteristic(hap.Characteristic.StatusLowBattery, true);
        }

        if (accessory.context.config.case_light) {
          const light = accessory.getService(hap.Service.Lightbulb);
          if (light) {
            light.updateCharacteristic(hap.Characteristic.On, false);
          }
        }

        setTimeout(this.startSockJS.bind(this, accessory), 30 * 1000);
      });
  }

  resetCaseLight(accessory: PlatformAccessory, state: number): void {
    setTimeout(() => {
      const light = accessory.getService(hap.Service.Lightbulb);
      if (light) {
        light.updateCharacteristic(hap.Characteristic.On, !state);
      }
    }, 100);
  }

  setCaseLight(accessory: PlatformAccessory, state: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const stateVal = state as number;

    let sensor: Service | undefined;
    if (accessory.context.config.occupancy_sensor) {
      sensor = accessory.getService(hap.Service.OccupancySensor);
    } else {
      sensor = accessory.getService(hap.Service.MotionSensor);
    }

    if (sensor?.getCharacteristic(hap.Characteristic.StatusActive).value) {
      const body = {
        command: 'M355 S'
      };
      if (state > 0) {
        body.command += '1 P' + Math.round(stateVal * 2.55);
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
          callback();
          if (!res.ok) {
            this.resetCaseLight(accessory, stateVal);
          }
        })
        .catch(error => callback(error));
    } else {
      callback();
      this.resetCaseLight(accessory, stateVal);
    }
  }

  setCaseLightToggle(accessory: PlatformAccessory, state: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const light = accessory.getService(hap.Service.Lightbulb);
    if (!light) {
      callback();
      return;
    }
    const on = light.getCharacteristic(hap.Characteristic.On).value;
    if (state && !on) {
      const brightness = light.getCharacteristic(hap.Characteristic.Brightness).value;
      if (brightness) {
        this.setCaseLight(accessory, brightness, callback);
      }
    } else if (!state && on) {
      this.setCaseLight(accessory, 0, callback);
    } else {
      callback();
    }
  }

  addAccessory(instance: InstanceConfig): void {
    this.log('Initializing platform accessory ' + instance.name + '...');

    let accessory = this.accessories.find(cachedAccessory => {
      return cachedAccessory.context.config.url == instance.url;
    });

    if (!accessory) {
      const uuid = hap.uuid.generate(instance.url);

      accessory = new Accessory(instance.name, uuid);

      accessory.context.config = instance;

      if (instance.occupancy_sensor) {
        accessory.addService(hap.Service.OccupancySensor, instance.name);
      } else {
        accessory.addService(hap.Service.MotionSensor, instance.name);
      }
      accessory.addService(hap.Service.BatteryService, instance.name);

      this.api.registerPlatformAccessories('homebridge-octoprint-motion', 'octoprint', [accessory]);

      this.accessories.push(accessory);

      this.getInitState(accessory);
    } else {
      accessory.context.config = instance;

      const motion = accessory.getService(hap.Service.MotionSensor);
      const occupy = accessory.getService(hap.Service.OccupancySensor);

      if (instance.occupancy_sensor) {
        if (motion != undefined) {
          accessory.removeService(motion);
        }
        if (occupy == undefined) {
          accessory.addService(hap.Service.OccupancySensor, instance.name);
        }
      } else {
        if (occupy != undefined) {
          accessory.removeService(occupy);
        }
        if (motion == undefined) {
          accessory.addService(hap.Service.MotionSensor, instance.name);
        }
      }

      this.getInitState(accessory);
    }
  }

  getInitState(accessory: PlatformAccessory): void {
    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log(accessory.context.config.name + ' identify requested!');
    });

    const manufacturer = accessory.context.config.manufacturer || 'Gina Häußge';
    const model = accessory.context.config.model || 'OctoPrint';
    const serial = accessory.context.config.serial || accessory.context.config.url;
    const accInfo = accessory.getService(hap.Service.AccessoryInformation);
    if (accInfo) {
      accInfo
        .setCharacteristic(hap.Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(hap.Characteristic.Model, model)
        .setCharacteristic(hap.Characteristic.SerialNumber, serial);
    }

    let sensor: Service | undefined;
    if (accessory.context.config.occupancy_sensor) {
      sensor = accessory.getService(hap.Service.OccupancySensor);
    } else {
      sensor = accessory.getService(hap.Service.MotionSensor);
    }
    if (sensor) {
      sensor.setCharacteristic(hap.Characteristic.StatusActive, true);
    }

    accessory.context.config.case_light = accessory.context.config.case_light || false;

    let light = accessory.getService(hap.Service.Lightbulb);

    if (light != undefined && !accessory.context.config.case_light) {
      accessory.removeService(light);
    } else if (light == undefined && accessory.context.config.case_light) {
      light = accessory.addService(hap.Service.Lightbulb, accessory.context.config.name + ' Case Light');
      light.addCharacteristic(hap.Characteristic.Brightness);
    }

    if (light) {
      light.getCharacteristic(hap.Characteristic.Brightness)
        .on('set', this.setCaseLight.bind(this, accessory))
        .updateValue(100);
      light.getCharacteristic(hap.Characteristic.On)
        .on('set', this.setCaseLightToggle.bind(this, accessory))
        .updateValue(true);
    }

    accessory.updateReachability(true);
  }

  removeAccessories(accessories: Array<PlatformAccessory>): void {
    accessories.forEach(accessory => {
      this.api.unregisterPlatformAccessories('homebridge-octoprint-motion', 'octoprint', [accessory]);
      this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
  }
}

export = (api: API): void => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, OctoprintPlatform);
};