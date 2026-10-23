const Gree = require('gree-hvac-client');

// Use your network's broadcast address
Gree.Client.discover({ host: '192.168.7.255', timeout: 3000 })
    .then(devices => {
        for (const device of devices) {
            console.log(
                device.name,
                device.mac,
                device.address,
                device.version
            );
        }
    })
    .catch(error => {
        console.error(error);
    });
