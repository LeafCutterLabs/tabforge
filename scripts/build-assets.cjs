const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.join(__dirname, '..');
const output = path.join(root, 'assets');
fs.mkdirSync(output, { recursive: true });

execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'),
    '-c', path.join(root, 'tailwind.config.cjs'), '-i', path.join(__dirname, 'utilities.css'),
    '-o', path.join(output, 'utilities.css'), '--minify'], { cwd: root, stdio: 'inherit' });

const sources = ['index.html', 'app.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const names = [...new Set([...sources.matchAll(/data-lucide="([a-z0-9-]+)"/g)].map(match => match[1]))].sort();
const iconExports = names.map(name => name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(''));
buildSync({
    stdin: {
        contents: `import {createIcons, ${iconExports.join(',')}} from 'lucide';\nwindow.lucide = {createIcons: (options = {}) => createIcons({icons: {${iconExports.join(',')}}, ...options})};`,
        resolveDir: root
    },
    bundle: true, minify: true, format: 'iife', target: 'es2020',
    outfile: path.join(output, 'icons.js'), legalComments: 'eof'
});
fs.copyFileSync(path.join(root, 'node_modules/jszip/dist/jszip.min.js'), path.join(output, 'jszip.min.js'));
const notices = ['tailwindcss', 'lucide', 'jszip'].map(name => {
    const directory = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const license = fs.readdirSync(directory).find(file => /^LICENSE(?:\.(?:txt|markdown))?$/i.test(file));
    return `${name} ${pkg.version}\n${fs.readFileSync(path.join(directory, license), 'utf8')}`;
});
fs.writeFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(output, 'release.js'), `window.TabForgeRelease = Object.freeze(${JSON.stringify({ version: packageInfo.version })});\n`);
const deploy = path.join(root, 'dist');
if (path.dirname(deploy) !== root) throw new Error('Deploy output must stay inside the project');
fs.rmSync(deploy, { recursive: true, force: true });
fs.mkdirSync(deploy, { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css', 'editor.css', 'tab-model.js', 'commands.js', 'persistence.js', 'feature-catalog.js', 'feature-guide.js']) {
    fs.copyFileSync(path.join(root, file), path.join(deploy, file));
}
fs.cpSync(output, path.join(deploy, 'assets'), { recursive: true });
console.log(`Generated static CSS, ${names.length} icons, and ZIP support in assets/.`);
