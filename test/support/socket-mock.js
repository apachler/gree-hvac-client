/**
 * Shared mock for the dgram socket the Client opens.
 *
 * The defaults model a socket that binds instantly, sends without errors and
 * never receives anything (the mocked device stays silent). Specs that need a
 * different behaviour override individual methods, most commonly `on` to
 * capture the message callback and feed device responses back:
 *
 *     createSocketMock({ on: (event, cb) => (feedClient = cb) });
 *
 * @param {object} overrides methods to replace on the mock
 * @returns {object} a dgram.Socket stand-in
 */
const createSocketMock = (overrides = {}) => ({
    bind: jest.fn(cb => cb()),
    setBroadcast: jest.fn(),
    on: jest.fn(),
    send: (buff, start, length, port, host, cb) => cb(),
    close: cb => cb(),
    ...overrides,
});

module.exports = { createSocketMock };
