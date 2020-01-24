# homebridge-octoprint-motion
[OctoPrint](https://octoprint.org) Plugin for [Homebridge](https://github.com/nfarina/homebridge)

This plugin exposes the current status of a 3D printer connected to OctoPrint as a Motion Sensor.

### Installation
1. Install homebridge using `npm install -g homebridge`.
2. Install this plugin using `npm install -g homebridge-octoprint-motion`.
3. Update your configuration file. See configuration sample below.

### Configuration
Edit your `config.json` accordingly. Configuration sample:
 ```
    "platforms": [
        {
            "platform": "octoprint",
            "polling_seconds": 10,
            "instances": [
            {
                "name": "Monoprice",
                "manufacturer": "Monoprice",
                "model": "Maker Ultimate",
                "url": "http://monoprice.local",
                "api_key": "MGGXSMVGBF4FZBR1B40BWLKKQVMRSLVZ"
            },
            {
                "name": "Big Boy",
                "manufacturer": "Creality",
                "model": "CR-10S S4",
                "url": "http://bigboy.local",
                "api_key": "JSA0AB6WXZ36DBFGO8R6LQYCKQZ6SI1T"
            }
            ]
        }
    ]
```

| Fields             | Description                                                                  | Required |
|--------------------|------------------------------------------------------------------------------|----------|
| platform           | Must always be `octoprint`.                                                  | Yes      |
| polling_seconds    | Number of seconds between polling for status. Polling disabled if missing.   | No       |
| instances          | Array of Octoprint instance configs (multiple supported).                    | Yes      |
| \|- name           | Name of your device.                                                         | No       |
| \|- manufacturer   | Manufacturer of your device.                                                 | No       |
| \|- model          | Model of your device.                                                        | No       |
| \|- serial         | Serial of your device.                                                       | No       |
| \|- url            | URL of your OctoPrint instance.                                              | Yes      |
| \|- api_key        | API Key for your OctoPrint instance.                                         | Yes      |
