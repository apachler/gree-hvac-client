const fc = require('fast-check');

const { Client, PROPERTY, VALUE } = require('../src/client');
const { EcbCipher, GcmCipher } = require('../src/encryption-service');
const { ClientError } = require('../src/errors');
const {
    PropertyTransformer,
    encodeFahrenheit,
    decodeFahrenheit,
} = require('../src/property-transformer');
const { parseHid, firmwareWarning } = require('../src/firmware');

jest.useFakeTimers();

/**
 * Property-based (fuzz) tests with fast-check: whatever arrives on the
 * socket, the client fails only with a ClientError, never with a TypeError
 * that would escape as an unhandled rejection; and the encodings round-trip.
 */
describe('Fuzzing', () => {
    describe('Client message handling', () => {
        let SUT;
        const device = new EcbCipher('FuzzDeviceKey123');

        // A fresh client per run, so a counterexample reproduces on its own
        const reset = () => {
            SUT?._dispose();
            SUT = new Client({ autoConnect: false, poll: false });
            SUT.on('error', () => {});
            // bound to a device, with a socket that swallows every send
            SUT._socket = {
                send: (buff, start, length, port, host, cb) => cb(),
            };
            SUT._cid = 'f4911e000001';
            SUT._bound = true;
            SUT._encryptionService._activeCipher.setKey('FuzzDeviceKey123');
        };

        beforeEach(reset);

        afterEach(() => {
            SUT._dispose();
            SUT._socket = null;
        });

        const expectOnlyClientErrors = async buffer => {
            reset();
            try {
                await SUT._handleResponse(Buffer.from(buffer));
            } catch (error) {
                if (!(error instanceof ClientError)) {
                    throw error;
                }
            }
        };

        it('survives arbitrary bytes', async () => {
            await fc.assert(
                fc.asyncProperty(fc.string(), expectOnlyClientErrors),
                { numRuns: 300 }
            );
        });

        it('survives arbitrary JSON envelopes', async () => {
            await fc.assert(
                fc.asyncProperty(fc.json(), json =>
                    expectOnlyClientErrors(json)
                ),
                { numRuns: 300 }
            );
        });

        it('survives well-encrypted packs with arbitrary content', async () => {
            const value = fc.oneof(
                fc.jsonValue(),
                fc.array(fc.oneof(fc.string(), fc.integer(), fc.constant(null)))
            );
            const pack = fc.record(
                {
                    t: fc.constantFrom('dat', 'res', 'subList', 'weird', 'dev'),
                    // vendor codes the client knows, and names that clash
                    // with Object.prototype
                    cols: fc.oneof(
                        value,
                        fc.array(
                            fc.constantFrom(
                                'Pow',
                                'SetTem',
                                'TemUn',
                                'TemRec',
                                'Add0.5',
                                'OutEnvTem',
                                'LigSen',
                                'hid',
                                'constructor',
                                'toString',
                                '__proto__',
                                'hasOwnProperty'
                            )
                        )
                    ),
                    opt: fc.oneof(
                        value,
                        fc.array(
                            fc.constantFrom(
                                'Pow',
                                'Lig',
                                'constructor',
                                '__proto__'
                            )
                        )
                    ),
                    dat: value,
                    val: value,
                    p: value,
                    list: value,
                    mac: fc.string(),
                },
                { requiredKeys: ['t'] }
            );

            await fc.assert(
                fc.asyncProperty(pack, async content => {
                    const message = JSON.stringify({
                        t: 'pack',
                        i: 0,
                        cid: SUT._cid,
                        pack: device.encrypt(content).payload,
                    });
                    await expectOnlyClientErrors(message);
                }),
                { numRuns: 500 }
            );
        });
    });

    describe('Encodings', () => {
        it('encrypts and decrypts any JSON object, ECB and GCM', () => {
            const key = fc
                .string({ minLength: 16, maxLength: 16, unit: 'binary-ascii' })
                .filter(k => Buffer.byteLength(k) === 16);
            fc.assert(
                fc.property(
                    fc.constantFrom(EcbCipher, GcmCipher),
                    key,
                    fc.dictionary(fc.string(), fc.jsonValue()),
                    (Cipher, k, object) => {
                        const cipher = new Cipher(k);
                        const encrypted = cipher.encrypt(object);
                        const decrypted = cipher.decrypt({
                            pack: encrypted.payload,
                            tag: encrypted.tag,
                        }).payload;
                        expect(decrypted).toEqual(
                            JSON.parse(JSON.stringify(object))
                        );
                    }
                )
            );
        });

        it('round-trips every enum value of every property', () => {
            const SUT = new PropertyTransformer();
            const enumValue = fc
                .constantFrom(
                    ...Object.keys(PROPERTY).filter(
                        p => Object.keys(VALUE[p]).length > 0
                    )
                )
                .chain(property =>
                    fc.tuple(
                        fc.constant(property),
                        fc.constantFrom(...Object.keys(VALUE[property]))
                    )
                );
            const readOnly = ['waterFull', 'cleanFilter'];

            fc.assert(
                fc.property(enumValue, ([property, value]) => {
                    fc.pre(!readOnly.includes(property));
                    const vendor = SUT.toVendor({ [property]: value });
                    expect(SUT.fromVendor(vendor)).toMatchObject({
                        [property]: value,
                    });
                })
            );
        });

        it('round-trips °F and half-degree °C setpoints', () => {
            fc.assert(
                // up to 104 °F (40 °C): a larger SetTem is taken to be °F already
                fc.property(fc.integer({ min: -40, max: 104 }), f => {
                    const { SetTem, TemRec } = encodeFahrenheit(f);
                    expect(decodeFahrenheit(SetTem, TemRec)).toBe(f);
                })
            );

            const half = new PropertyTransformer({ halfDegree: true });
            fc.assert(
                fc.property(fc.integer({ min: 16, max: 80 }), n => {
                    const celsius = n / 2;
                    expect(
                        half.fromVendor(half.toVendor({ temperature: celsius }))
                    ).toEqual({ temperature: celsius });
                })
            );
        });

        it('parses any firmware id without throwing', () => {
            fc.assert(
                fc.property(fc.oneof(fc.string(), fc.jsonValue()), hid => {
                    const firmware = parseHid(hid);
                    expect(typeof firmware).toBe('object');
                    const warning = firmwareWarning(firmware);
                    expect(['string', 'undefined']).toContain(typeof warning);
                })
            );
        });
    });
});
