const errors = require('../src/errors');
const Gree = require('../index');

describe('Errors', () => {
    it('are exported for instanceof checks', () => {
        for (const [name, ErrorClass] of Object.entries(errors)) {
            expect(Gree[name]).toBe(ErrorClass);
        }
    });

    it('keep the cause as origin', () => {
        const cause = new SyntaxError('Unexpected token');
        const error = new errors.ClientMessageParseError(cause, {
            jsonBuffer: '{',
        });

        expect(error).toBeInstanceOf(errors.ClientError);
        expect(error.message).toBe(
            'Can not parse device JSON response (Unexpected token)'
        );
        expect(error.origin).toBe(cause);
        expect(error.props).toEqual({ jsonBuffer: '{' });
    });

    it('carry the unknown message in props', () => {
        const error = new errors.ClientUnknownMessageError({
            pack: { t: 'weird' },
        });

        expect(error.origin).toBeUndefined();
        expect(error.props).toEqual({ pack: { t: 'weird' } });
    });
});
