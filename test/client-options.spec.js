const { createOptions } = require('../src/client-options');

describe('Client options', () => {
    it('should coalesce in order of client options, env and default options', () => {
        process.env.GREE_HVAC_HOST = '10.0.0.1';
        process.env.GREE_HVAC_PORT = '1234';

        expect(
            createOptions({
                host: '1.2.3.4',
            })
        ).toMatchInlineSnapshot(`
            {
              "autoConnect": true,
              "bindTimeout": 1000,
              "commandInterval": 100,
              "connectTimeout": 3000,
              "debug": false,
              "encodedTargetHumidity": false,
              "halfDegree": false,
              "host": "1.2.3.4",
              "logLevel": "error",
              "mac": null,
              "maxNoResponse": 3,
              "poll": true,
              "pollingInterval": 3000,
              "pollingTimeout": 1000,
              "port": 1234,
              "reconnectMaxDelay": 30000,
              "recoveryDelay": 0,
              "reopenSocket": true,
              "silent": false,
              "statusBatchSize": 20,
              "subUnit": null,
            }
        `);
    });

    it('coerces env strings to the type of the default', () => {
        process.env.GREE_HVAC_PORT = 'not a number';
        process.env.GREE_HVAC_POLL = 'off';
        process.env.GREE_HVAC_MAC = 'f4911e000001';
        try {
            expect(createOptions({})).toMatchObject({
                port: 7000,
                poll: false,
                mac: 'f4911e000001',
            });
        } finally {
            delete process.env.GREE_HVAC_PORT;
            delete process.env.GREE_HVAC_POLL;
            delete process.env.GREE_HVAC_MAC;
            delete process.env.GREE_HVAC_HOST;
        }
    });
});
