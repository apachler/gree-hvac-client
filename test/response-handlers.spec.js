const assert = require('assert');

const { Client } = require('../src/client');

/**
 * Regression tests for malformed device responses.
 *
 * A device that returns a set-confirmation (`res`) or status (`dat`) packet
 * without the expected parallel value arrays used to throw inside the
 * `forEach` and, being an unhandled `error`, crash the whole host process
 * (inwaar/node-red-contrib-gree-hvac#11 and #12). The handlers must now skip
 * such packets gracefully — no throw, no `error` event, no `success` emit.
 */
describe('malformed response handling', () => {
    /**
     * @returns {Client} a client that never opens a socket
     */
    function makeClient() {
        return new Client({ autoConnect: false });
    }

    /**
     * Fail the test if the client emits an `error` while running `fn`.
     *
     * @param {Client} client
     * @param {Function} fn
     */
    function assertNoError(client, fn) {
        let emitted = null;
        client.on('error', err => {
            emitted = err;
        });
        fn();
        assert.equal(emitted, null, 'should not emit an error event');
    }

    describe('#_handleUpdateConfirmResponse()', () => {
        it('emits success for a well-formed res packet', () => {
            const SUT = makeClient();
            let success = null;
            SUT.on('success', updated => {
                success = updated;
            });

            SUT._handleUpdateConfirmResponse({ opt: ['Pow'], val: [1] });

            assert.deepEqual(success, { power: 'on' });
        });

        it('supports the legacy `p` value array', () => {
            const SUT = makeClient();
            let success = null;
            SUT.on('success', updated => {
                success = updated;
            });

            SUT._handleUpdateConfirmResponse({ opt: ['Pow'], p: [0] });

            assert.deepEqual(success, { power: 'off' });
        });

        it('ignores a packet with no value array instead of throwing', () => {
            const SUT = makeClient();
            let success = false;
            SUT.on('success', () => {
                success = true;
            });

            assertNoError(SUT, () => {
                assert.doesNotThrow(() =>
                    SUT._handleUpdateConfirmResponse({ opt: ['Pow'] })
                );
            });
            assert.equal(success, false);
        });

        it('ignores a packet whose opt is not an array', () => {
            const SUT = makeClient();
            assertNoError(SUT, () => {
                assert.doesNotThrow(() =>
                    SUT._handleUpdateConfirmResponse({ val: [1] })
                );
            });
        });
    });

    describe('#_handleStatusResponse()', () => {
        it('updates properties for a well-formed dat packet', () => {
            const SUT = makeClient();
            let updated = null;
            SUT.on('update', changed => {
                updated = changed;
            });

            SUT._handleStatusResponse({ cols: ['Pow'], dat: [1] });

            assert.deepEqual(updated, { power: 'on' });
        });

        it('ignores a packet with no dat array instead of throwing', () => {
            const SUT = makeClient();
            assertNoError(SUT, () => {
                assert.doesNotThrow(() =>
                    SUT._handleStatusResponse({ cols: ['Pow'] })
                );
            });
        });
    });
});
