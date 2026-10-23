const { PropertyTransformer } = require('../src/property-transformer');
const { parseHid, firmwareWarning } = require('../src/firmware');

/**
 * Opt-in encodings (half-degree °C, encoded target humidity), the light
 * sensor, humidity control and the firmware id.
 */
describe('More properties', () => {
    describe('halfDegree option', () => {
        const SUT = new PropertyTransformer({ halfDegree: true });

        it('sends a half degree as Add0.5', () => {
            expect(SUT.toVendor({ temperature: 23.5 })).toEqual({
                SetTem: 23,
                'Add0.5': 1,
            });
            expect(SUT.toVendor({ temperature: 23 })).toEqual({
                SetTem: 23,
                'Add0.5': 0,
            });
        });

        it('decodes Add0.5, also from state', () => {
            expect(SUT.fromVendor({ SetTem: 23, 'Add0.5': 1 })).toEqual({
                temperature: 23.5,
            });
            expect(SUT.fromVendor({ SetTem: 23 }, { 'Add0.5': 0 })).toEqual({
                temperature: 23,
            });
        });

        it('polls Add0.5 only when enabled', () => {
            expect(SUT.statusColumns()).toContain('Add0.5');
            expect(new PropertyTransformer().statusColumns()).not.toContain(
                'Add0.5'
            );
        });

        it('leaves °F setpoints to TemRec', () => {
            expect(SUT.toVendor({ temperature: 76 }, { TemUn: 1 })).toEqual({
                SetTem: 24,
                TemRec: 1,
                TemUn: 1,
            });
        });

        it('is off by default', () => {
            expect(
                new PropertyTransformer().toVendor({ temperature: 23 })
            ).toEqual({ SetTem: 23 });
        });
    });

    describe('encodedTargetHumidity option', () => {
        const SUT = new PropertyTransformer({ encodedTargetHumidity: true });

        it('encodes % as (% - 15) / 5', () => {
            expect(SUT.toVendor({ targetHumidity: 55 })).toEqual({ Dwet: 8 });
            expect(SUT.fromVendor({ Dwet: 8 })).toEqual({ targetHumidity: 55 });
        });

        it('passes % through by default', () => {
            expect(
                new PropertyTransformer().toVendor({ targetHumidity: 55 })
            ).toEqual({ Dwet: 55 });
        });
    });

    describe('humidityMode and lightSensor', () => {
        const SUT = new PropertyTransformer();

        it('maps the humidity control modes', () => {
            expect(SUT.toVendor({ humidityMode: 'off' })).toEqual({ Dmod: 15 });
            expect(SUT.fromVendor({ Dmod: 0 })).toEqual({
                humidityMode: 'target',
            });
            expect(SUT.fromVendor({ Dmod: 2 })).toEqual({
                humidityMode: 'smart',
            });
        });

        it('inverts LigSen and turns the lights on with it', () => {
            expect(SUT.toVendor({ lightSensor: 'on' })).toEqual({
                LigSen: 0,
                Lig: 1,
            });
            expect(SUT.toVendor({ lightSensor: 'off' })).toEqual({
                LigSen: 1,
            });
            expect(SUT.toVendor({ lightSensor: 'on', lights: 'off' })).toEqual({
                LigSen: 0,
                Lig: 0,
            });
            expect(SUT.fromVendor({ LigSen: 0 })).toEqual({
                lightSensor: 'on',
            });
        });
    });

    describe('firmware id', () => {
        it('splits a hid', () => {
            expect(parseHid('362001000762+U-CS532AE(LT)V3.31.bin')).toEqual({
                firmwareCode: '362001000762',
                moduleType: 'U-CS532AE(LT)',
                firmwareVersion: '3.31',
            });
            expect(parseHid('362001065279')).toEqual({
                firmwareCode: '362001065279',
            });
            expect(parseHid('')).toEqual({});
            expect(parseHid(undefined)).toEqual({});
        });

        it('warns for firmwares with known cloud-only builds', () => {
            expect(
                firmwareWarning({
                    firmwareCode: '362001068411',
                    firmwareVersion: '1.02',
                })
            ).toMatch(/1\.02 was found to be cloud-only/);
            expect(
                firmwareWarning({ firmwareCode: '362001000762' })
            ).toBeUndefined();
        });
    });
});
