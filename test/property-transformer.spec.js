const assert = require('assert');
const {
    PropertyTransformer,
    decodeCurrentTemperature,
} = require('../src/property-transformer');

describe('PropertyTransformer', function () {
    describe('#fromVendor()', function () {
        it('should transform from vendor to human friendly', function () {
            const SUT = new PropertyTransformer();
            const result = SUT.fromVendor({
                Mod: 1,
                SetTem: 25,
                TemSen: 67,
            });

            assert.deepEqual(result, {
                mode: 'cool',
                temperature: 25,
                currentTemperature: 27,
            });
        });

        it('should skip unknown vendor codes instead of throwing', function () {
            const SUT = new PropertyTransformer();
            // SlpMod is written as a companion of SwhSlp but has no friendly
            // name; a device echoing it back must not crash fromVendor.
            const result = SUT.fromVendor({
                Pow: 1,
                SwhSlp: 1,
                SlpMod: 1,
            });

            assert.deepEqual(result, {
                power: 'on',
                sleep: 'on',
            });
        });

        it('should not subtract 40 from vendor value in case of zero', function () {
            const SUT = new PropertyTransformer();
            const result = SUT.fromVendor({
                TemSen: 0,
            });

            assert.deepEqual(result, {
                currentTemperature: 0,
            });
        });

        // Regression for inwaar/node-red-contrib-gree-hvac#10: some firmwares
        // report TemSen already in real °C (no +40 offset). Blindly subtracting
        // 40 then yields an impossible reading (31 − 40 = −9 °C, the exact value
        // users reported). The sanity guard treats such already-real values as-is.
        it('should pass TemSen through unchanged when -40 would be implausibly cold (#10)', function () {
            const SUT = new PropertyTransformer();
            assert.deepEqual(SUT.fromVendor({ TemSen: 31 }), {
                currentTemperature: 31,
            });
        });
    });

    describe('decodeCurrentTemperature()', function () {
        it('keeps 0 as the unavailable sentinel', function () {
            assert.equal(decodeCurrentTemperature(0), 0);
        });

        it('subtracts the +40 offset for normal offset firmwares', function () {
            assert.equal(decodeCurrentTemperature(65), 25); // sim default
            assert.equal(decodeCurrentTemperature(67), 27);
            assert.equal(decodeCurrentTemperature(40), 0); // boundary: decoded floor
        });

        it('passes the raw value through when decoding drops below the floor', function () {
            assert.equal(decodeCurrentTemperature(31), 31); // the reported -9 case
            assert.equal(decodeCurrentTemperature(39), 39); // decoded -1 < 0 -> raw
            assert.equal(decodeCurrentTemperature(20), 20);
        });
    });
    describe('#toVendor()', function () {
        it('should transform from human friendly to vendor', function () {
            const SUT = new PropertyTransformer();
            const result = SUT.toVendor({
                mode: 'cool',
                temperature: 25,
            });

            assert.deepEqual(result, {
                Mod: 1,
                SetTem: 25,
            });
        });
        it('should write paired SwhSlp + SlpMod when toggling sleep', function () {
            const SUT = new PropertyTransformer();

            assert.deepEqual(SUT.toVendor({ sleep: 'on' }), {
                SwhSlp: 1,
                SlpMod: 1,
            });
            assert.deepEqual(SUT.toVendor({ sleep: 'off' }), {
                SwhSlp: 0,
                SlpMod: 0,
            });
        });

        it('should not allow to change read-only property', function () {
            const SUT = new PropertyTransformer();
            assert.throws(
                () => {
                    SUT.toVendor({
                        currentTemperature: 30,
                    });
                },
                {
                    name: 'Error',
                    message: 'Cannot set read-only property currentTemperature',
                }
            );
        });
    });
});
