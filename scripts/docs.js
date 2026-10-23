'use strict';

// Render README.md from README.hbs + the JSDoc in src/*.js (`npm run docs`).
// Renders first and writes only on success, so a JSDoc that jsdoc cannot
// parse fails the script (and the docs CI check) instead of leaving a
// truncated README.md behind.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const main = async () => {
    const { default: jsdoc2md } = await import('jsdoc-to-markdown');
    const markdown = await jsdoc2md.render({
        files: path.join(root, 'src', '*.js'),
        template: fs.readFileSync(path.join(root, 'README.hbs'), 'utf8'),
    });
    fs.writeFileSync(path.join(root, 'README.md'), markdown);
};

main().catch(error => {
    console.error(`README.md not updated: ${error.message}`);
    process.exit(1);
});
