const { Client } = require('../src/client');

/**
 * The beeper is not device state but a flag on every command: older
 * firmwares read Buzzer_ON_OFF (1 = silent), newer ones BuzzerCtrl (0 = silent).
 */
describe('silent option', () => {
    const sentCommand = async options => {
        const SUT = new Client({ autoConnect: false, ...options });
        const sendRequest = jest.spyOn(SUT, '_sendRequest').mockResolvedValue();

        await SUT.setProperty('power', 'on');

        return sendRequest.mock.calls[0][0];
    };

    it('sends no beeper flags by default', async () => {
        expect(await sentCommand()).toEqual({
            opt: ['Pow'],
            p: [1],
            t: 'cmd',
        });
    });

    it('asks the unit not to beep', async () => {
        expect(await sentCommand({ silent: true })).toEqual({
            opt: ['Pow', 'Buzzer_ON_OFF', 'BuzzerCtrl'],
            p: [1, 1, 0],
            t: 'cmd',
        });
    });
});
