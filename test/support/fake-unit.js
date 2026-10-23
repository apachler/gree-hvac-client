const dgram = require('dgram');

const { EcbCipher, GcmCipher } = require('../../src/encryption-service');

const DEVICE_KEY = 'FakeUnitKey12345';

/**
 * A Gree unit on a real UDP socket (127.0.0.1, random port) for end-to-end
 * tests: answers scan, bind, status, cmd, subList and wlan like a unit would,
 * encrypting with AES-ECB or AES-GCM.
 *
 * @param {object} [options]
 * @param {'ecb'|'gcm'} [options.cipher] cipher of the unit
 * @param {object} [options.state] vendor properties (code → value)
 * @param {number} [options.maxColumns] status requests with more columns go unanswered
 * @param {string[]} [options.subUnits] indoor unit MACs (makes it a multi-split gateway)
 * @returns {Promise<object>} the running unit: `port`, `state`, `received`, `close()`
 */
const startFakeUnit = ({
    cipher = 'ecb',
    state = {},
    maxColumns = Infinity,
    subUnits = [],
} = {}) => {
    const Cipher = cipher === 'gcm' ? GcmCipher : EcbCipher;
    const generic = new Cipher();
    const device = new Cipher(DEVICE_KEY);
    const mac = 'f4911e0000aa';
    const socket = dgram.createSocket('udp4');
    const unit = {
        mac,
        state: { ...state },
        received: [],
        port: null,
        close: () => new Promise(resolve => socket.close(resolve)),
    };

    const reply = (rinfo, pack, key = device, envelope = {}) => {
        const encrypted = key.encrypt(pack);
        const message = Buffer.from(
            JSON.stringify({
                t: 'pack',
                i: 0,
                uid: 0,
                cid: mac,
                tcid: '',
                ...envelope,
                pack: encrypted.payload,
                ...(encrypted.tag && { tag: encrypted.tag }),
            })
        );
        socket.send(message, rinfo.port, rinfo.address);
    };

    const decrypt = message => {
        for (const key of [device, generic]) {
            try {
                return { pack: key.decrypt(message).payload, key };
            } catch {
                // try the next key
            }
        }
        return { pack: null, key: null };
    };

    socket.on('message', (buffer, rinfo) => {
        const message = JSON.parse(String(buffer));
        if (message.t === 'scan') {
            unit.received.push(message);
            return reply(
                rinfo,
                {
                    t: 'dev',
                    cid: mac,
                    mac,
                    name: 'fake-unit',
                    ver: 'V1.2.3',
                    subCnt: subUnits.length,
                },
                generic,
                { i: 1 }
            );
        }
        if (message.t === 'wlan') {
            unit.received.push(message);
            const ret = Buffer.from(JSON.stringify({ t: 'ret', r: 200, mac }));
            return socket.send(ret, rinfo.port, rinfo.address);
        }

        const { pack, key } = decrypt(message);
        if (!pack) {
            return;
        }
        unit.received.push({ ...message, pack });

        if (pack.t === 'bind') {
            return reply(
                rinfo,
                { t: 'bindok', mac, key: DEVICE_KEY, r: 200 },
                generic,
                { i: 1 }
            );
        }
        if (message.t === 'subList' || pack.t === 'subList') {
            return reply(
                rinfo,
                {
                    t: 'subList',
                    mac,
                    c: subUnits.length,
                    list: subUnits.map(sub => ({ mac: sub })),
                },
                key
            );
        }
        if (pack.t === 'status') {
            if (pack.cols.length > maxColumns) {
                return; // like firmwares that go silent on long requests
            }
            const cols = pack.cols.filter(col => col in unit.state);
            return reply(rinfo, {
                t: 'dat',
                mac,
                r: 200,
                cols,
                dat: cols.map(col => unit.state[col]),
            });
        }
        if (pack.t === 'cmd') {
            pack.opt.forEach((opt, i) => (unit.state[opt] = pack.p[i]));
            return reply(rinfo, {
                t: 'res',
                mac,
                r: 200,
                opt: pack.opt,
                p: pack.p,
                val: pack.p,
            });
        }
    });

    return new Promise(resolve =>
        socket.bind(0, '127.0.0.1', () => {
            unit.port = socket.address().port;
            resolve(unit);
        })
    );
};

module.exports = { startFakeUnit };
