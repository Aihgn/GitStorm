// Build a throwaway repository that photographs well.
//
//   node scripts/make-demo-repo.js [outDir] [--force]
//
// Produces a small fake web app with the things a screenshot needs and this
// project's own history lacks: several branches alive at once, merges, tags, an
// origin the local branch is both ahead of and behind, stashes, renames and
// deletions, and one file edited by three people so blame has something to say.
//
// Defaults to ~/Desktop/gitstorm-demo, with its bare origin beside it.

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const force = args.includes('--force');
const OUT = path.resolve(args.find(a => !a.startsWith('--')) ?? path.join(os.homedir(), 'Desktop', 'gitstorm-demo'));
const ORIGIN = `${OUT}-origin.git`;

// Handles, not names: these end up in screenshots, so nothing here should read
// as a real person.
const PEOPLE = {
    nova: 'nova <nova@example.com>',
    zephyr: 'zephyr <zephyr@example.com>',
    quill: 'quill <quill@example.com>'
};

/** Commit clocks walk forward from here so relative times read naturally. */
let clock = new Date(Date.now() - 150 * 86400000);

function git(...cmdArgs) {
    return cp.execFileSync('git', cmdArgs, { cwd: OUT, stdio: 'pipe' }).toString();
}

function write(rel, content) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

/** Commit whatever is staged, advancing the clock by `hours`. */
function commit(message, who, hours = 7) {
    clock = new Date(clock.getTime() + hours * 3600000);
    const stamp = clock.toISOString();
    const [name, email] = PEOPLE[who].split(' <');
    cp.execFileSync('git', ['add', '-A'], { cwd: OUT, stdio: 'pipe' });
    cp.execFileSync('git', ['commit', '-q', '-m', message], {
        cwd: OUT,
        stdio: 'pipe',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: name,
            GIT_AUTHOR_EMAIL: email.replace('>', ''),
            GIT_AUTHOR_DATE: stamp,
            GIT_COMMITTER_NAME: name,
            GIT_COMMITTER_EMAIL: email.replace('>', ''),
            GIT_COMMITTER_DATE: stamp
        }
    });
}

function merge(branch, message, who) {
    clock = new Date(clock.getTime() + 3600000);
    const stamp = clock.toISOString();
    const [name, email] = PEOPLE[who].split(' <');
    cp.execFileSync('git', ['merge', '--no-ff', '-q', '-m', message, branch], {
        cwd: OUT,
        stdio: 'pipe',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: name,
            GIT_AUTHOR_EMAIL: email.replace('>', ''),
            GIT_AUTHOR_DATE: stamp,
            GIT_COMMITTER_NAME: name,
            GIT_COMMITTER_EMAIL: email.replace('>', ''),
            GIT_COMMITTER_DATE: stamp
        }
    });
}

// --------------------------------------------------------------- the content
//
// session.js grows a line or two per commit from three different people, which
// is what makes the blame column worth photographing.

const session = [];
const sessionFile = () =>
    'const crypto = require(\'crypto\');\n\n' +
    'const SESSIONS = new Map();\n\n' +
    session.join('\n') + '\n\nmodule.exports = { SESSIONS, ...exportsOf(SESSIONS) };\n';

function addSession(lines) {
    session.push(lines.trimEnd());
    write('src/auth/session.js', sessionFile());
}

// -------------------------------------------------------------------- build

/**
 * Windows keeps a handle on a folder that is open in an editor or Explorer, and
 * git's pack files are read-only, so a plain rmSync can fail on both counts.
 */
function remove(dir) {
    if (!fs.existsSync(dir)) { return; }
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
        if (e.code !== 'EPERM' && e.code !== 'EBUSY') { throw e; }
        console.error(
            `Cannot replace ${dir} — another process is holding it open.\n` +
            'Close it in VS Code and Explorer (an Extension Development Host counts),\n' +
            'or pass a different output path:\n' +
            '  npm run demo-repo -- C:\\some\\other\\path'
        );
        process.exit(1);
    }
}

function build() {
    if (fs.existsSync(OUT) && !force) {
        console.error(`${OUT} already exists. Pass --force to replace it.`);
        process.exit(1);
    }
    remove(OUT);
    remove(ORIGIN);
    fs.mkdirSync(OUT, { recursive: true });

    cp.execFileSync('git', ['init', '-q', '-b', 'main', OUT], { stdio: 'pipe' });
    git('config', 'commit.gpgsign', 'false');
    git('config', 'user.name', 'nova');
    git('config', 'user.email', 'nova@example.com');

    // --- groundwork on main -------------------------------------------------
    write('README.md', '# Aurora\n\nA small booking service.\n');
    write('package.json', JSON.stringify({ name: 'aurora', version: '0.1.0', private: true }, null, 2) + '\n');
    commit('chore: scaffold the project', 'nova');

    write('src/server.js',
        'const http = require(\'http\');\nconst { route } = require(\'./router\');\n\n' +
        'http.createServer(route).listen(process.env.PORT ?? 3000);\n');
    write('src/router.js', 'function route(req, res) {\n    res.end(\'aurora\\n\');\n}\n\nmodule.exports = { route };\n');
    commit('feat: serve requests through a tiny router', 'nova');

    write('src/db/schema.sql',
        'CREATE TABLE bookings (\n    id        INTEGER PRIMARY KEY,\n' +
        '    venue_id  INTEGER NOT NULL,\n    seat      TEXT    NOT NULL,\n' +
        '    held_until DATETIME\n);\n');
    commit('feat: bookings table', 'zephyr');

    addSession('function createSession(userId) {\n    const id = crypto.randomUUID();\n    SESSIONS.set(id, { userId });\n    return id;\n}');
    write('src/legacy/booking-v1.js',
        '// The original single-file booking flow. Superseded, kept until v1.\n' +
        'function bookSeat(venueId, seat) {\n    return { venueId, seat, held: true };\n}\n\n' +
        'module.exports = { bookSeat };\n');
    commit('feat: in-memory sessions', 'zephyr');
    git('tag', '-a', 'v0.1.0', '-m', 'first cut');

    // A second long-lived branch, forked early and never merged, so one lane
    // runs the height of the graph instead of every branch closing immediately.
    git('checkout', '-q', '-b', 'feat/pricing');
    write('src/pricing.js',
        'const TIERS = { standard: 1, premium: 1.8, box: 3.2 };\n\n' +
        'function priceFor(tier, base) {\n    return Math.round(base * (TIERS[tier] ?? 1));\n}\n\n' +
        'module.exports = { priceFor, TIERS };\n');
    commit('feat(pricing): tier multipliers', 'zephyr');
    write('test/pricing.test.js',
        'const assert = require(\'assert\');\nconst { priceFor } = require(\'../src/pricing\');\n\n' +
        'assert.strictEqual(priceFor(\'premium\', 100), 180);\n');
    commit('test(pricing): premium tier rounds up', 'zephyr');
    git('checkout', '-q', 'main');

    // --- feat/login ---------------------------------------------------------
    git('checkout', '-q', '-b', 'feat/login');
    write('src/auth/login.js',
        'const { createSession } = require(\'./session\');\n\n' +
        'async function login(email, password) {\n' +
        '    const user = await findUser(email);\n' +
        '    if (!user) { return null; }\n' +
        '    return createSession(user.id);\n}\n\nmodule.exports = { login };\n');
    commit('feat(auth): login handler', 'quill');

    addSession('function readSession(id) {\n    return SESSIONS.get(id) ?? null;\n}');
    commit('feat(auth): look a session up by id', 'quill');

    write('test/auth.test.js',
        'const assert = require(\'assert\');\nconst { login } = require(\'../src/auth/login\');\n\n' +
        'assert.strictEqual(await login(\'nobody@example.com\', \'x\'), null);\n');
    commit('test(auth): reject an unknown address', 'quill');

    git('checkout', '-q', 'main');
    merge('feat/login', 'Merge branch \'feat/login\'', 'nova');

    // --- feat/dashboard, overlapping with fix/session-expiry ----------------
    git('checkout', '-q', '-b', 'feat/dashboard');
    write('src/ui/dashboard.jsx',
        'export function Dashboard({ bookings }) {\n' +
        '    return <ul>{bookings.map(b => <li key={b.id}>{b.seat}</li>)}</ul>;\n}\n');
    commit('feat(ui): dashboard list', 'zephyr');
    write('src/ui/dashboard.css', '.dashboard {\n    display: grid;\n    gap: 8px;\n}\n');
    commit('feat(ui): lay the dashboard out on a grid', 'zephyr');

    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'fix/session-expiry');
    addSession('function expireSessions(now = Date.now()) {\n' +
        '    for (const [id, s] of SESSIONS) {\n' +
        '        if (s.expiresAt <= now) { SESSIONS.delete(id); }\n    }\n}');
    commit('fix(auth): drop sessions once they expire', 'nova');
    addSession('function touch(id, ttlMs = 30 * 60 * 1000) {\n' +
        '    const s = SESSIONS.get(id);\n    if (s) { s.expiresAt = Date.now() + ttlMs; }\n}');
    commit('fix(auth): sliding expiry on every request', 'nova');

    git('checkout', '-q', 'main');
    merge('fix/session-expiry', 'Merge branch \'fix/session-expiry\'', 'nova');
    merge('feat/dashboard', 'Merge branch \'feat/dashboard\'', 'zephyr');
    git('branch', '-q', '-d', 'feat/login');
    git('branch', '-q', '-d', 'fix/session-expiry');
    git('branch', '-q', '-d', 'feat/dashboard');

    // A rename and a deletion, so the changed-file list shows R and D.
    fs.mkdirSync(path.join(OUT, 'src/http'), { recursive: true }); // git mv will not create it
    git('mv', 'src/router.js', 'src/http/router.js');
    write('src/server.js',
        'const http = require(\'http\');\nconst { route } = require(\'./http/router\');\n\n' +
        'http.createServer(route).listen(process.env.PORT ?? 3000);\n');
    commit('refactor: move the router under src/http', 'quill');

    fs.rmSync(path.join(OUT, 'src/ui/dashboard.css'));
    write('src/ui/dashboard.jsx',
        'import styles from \'./dashboard.module.css\';\n\n' +
        'export function Dashboard({ bookings }) {\n' +
        '    return (\n        <ul className={styles.dashboard}>\n' +
        '            {bookings.map(b => <li key={b.id}>{b.seat}</li>)}\n' +
        '        </ul>\n    );\n}\n');
    write('src/ui/dashboard.module.css', '.dashboard {\n    display: grid;\n    gap: 8px;\n}\n');
    commit('refactor(ui): scope the dashboard styles to a module', 'zephyr');

    // A deliberate deletion with nothing replacing it, so the changed-file list
    // has a D to show alongside the A, M and R.
    fs.rmSync(path.join(OUT, 'src/legacy'), { recursive: true, force: true });
    commit('chore: drop the v1 booking path', 'quill');

    // One deliberately wide commit, so the details pane has a full file list to
    // photograph rather than two lines.
    write('.eslintrc.json', JSON.stringify({
        root: true, env: { node: true, es2022: true },
        parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
        rules: { eqeqeq: 'error', 'no-unused-vars': 'warn' }
    }, null, 2) + '\n');
    write('.editorconfig', 'root = true\n\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\n');
    write('.github/workflows/ci.yml',
        'name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n' +
        '    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n');
    write('package.json', JSON.stringify({
        name: 'aurora', version: '0.9.0', private: true,
        scripts: { lint: 'eslint src test', test: 'node --test' }
    }, null, 2) + '\n');
    write('src/http/router.js',
        'const routes = new Map();\n\nfunction route(req, res) {\n' +
        '    const handler = routes.get(req.url);\n' +
        '    if (!handler) { return notFound(req, res); }\n    return handler(req, res);\n}\n\n' +
        'function notFound(req, res) {\n    res.statusCode = 404;\n    res.end(\'not found\\n\');\n}\n\n' +
        'module.exports = { route, routes };\n');
    write('src/auth/login.js',
        'const { createSession } = require(\'./session\');\n\n' +
        'async function login(email, password) {\n' +
        '    const user = await findUser(email);\n' +
        '    if (!user) { return null; }\n' +
        '    if (!(await verify(password, user.hash))) { return null; }\n' +
        '    return createSession(user.id);\n}\n\nmodule.exports = { login };\n');
    write('test/auth.test.js',
        'const assert = require(\'assert\');\nconst { login } = require(\'../src/auth/login\');\n\n' +
        'assert.strictEqual(await login(\'nobody@example.com\', \'x\'), null);\n' +
        'assert.strictEqual(await login(\'nova@example.com\', \'wrong\'), null);\n');
    commit('chore: eslint, editorconfig and a CI workflow', 'nova');

    write('package.json', JSON.stringify({
        name: 'aurora', version: '1.0.0', private: true,
        scripts: { lint: 'eslint src test', test: 'node --test' }
    }, null, 2) + '\n');
    commit('chore: release 1.0.0', 'nova');
    git('tag', '-a', 'v1.0.0', '-m', 'first stable release');

    // --- an unmerged branch, so a lane stays open in the graph ---------------
    git('checkout', '-q', '-b', 'feat/audit-log');
    write('src/audit.js',
        'const entries = [];\n\nfunction record(actor, action, target) {\n' +
        '    entries.push({ at: new Date().toISOString(), actor, action, target });\n}\n\n' +
        'module.exports = { record, entries };\n');
    commit('feat(audit): append-only audit entries', 'quill');
    write('src/db/schema.sql',
        fs.readFileSync(path.join(OUT, 'src/db/schema.sql'), 'utf8') +
        '\nCREATE TABLE audit (\n    id     INTEGER PRIMARY KEY,\n' +
        '    actor  TEXT NOT NULL,\n    action TEXT NOT NULL,\n    at     DATETIME NOT NULL\n);\n');
    commit('feat(audit): audit table', 'quill');
    git('checkout', '-q', 'main');

    // --- origin, then diverge from it ---------------------------------------
    cp.execFileSync('git', ['init', '-q', '--bare', ORIGIN], { stdio: 'pipe' });
    git('remote', 'add', 'origin', ORIGIN);
    git('push', '-q', '-u', 'origin', 'main');
    git('push', '-q', 'origin', 'feat/audit-log');
    git('push', '-q', '--tags');

    // Two commits land on origin/main...
    write('docs/deploy.md', '# Deploying\n\n1. `npm ci`\n2. `npm run build`\n3. ship it\n');
    commit('docs: how to deploy', 'zephyr');
    write('src/http/router.js',
        'const routes = new Map();\n\nfunction route(req, res) {\n' +
        '    const handler = routes.get(req.url) ?? notFound;\n    return handler(req, res);\n}\n\n' +
        'function notFound(req, res) {\n    res.statusCode = 404;\n    res.end(\'not found\\n\');\n}\n\n' +
        'module.exports = { route, routes };\n');
    commit('feat(http): 404 instead of an empty body', 'zephyr');
    git('push', '-q', 'origin', 'main');

    // ...and the local branch rewinds off them and goes its own way, which is
    // what puts an "up 1, down 2" badge on the branch in the tree.
    git('reset', '-q', '--hard', 'HEAD~2');
    addSession('function revoke(id) {\n    return SESSIONS.delete(id);\n}');
    commit('feat(auth): revoke a session by id', 'nova');

    // --- stashes and a clean tree -------------------------------------------
    write('src/ui/dashboard.jsx',
        fs.readFileSync(path.join(OUT, 'src/ui/dashboard.jsx'), 'utf8')
            .replace('{b.seat}', '{b.seat} — {b.venue}'));
    git('stash', 'push', '-q', '-m', 'wip: show the venue on each row');
    write('test/session.test.js',
        'const assert = require(\'assert\');\nconst { SESSIONS, revoke } = require(\'../src/auth/session\');\n\n' +
        'SESSIONS.set(\'abc\', { userId: 1 });\nassert.strictEqual(revoke(\'abc\'), true);\n');
    git('stash', 'push', '-q', '-u', '-m', 'wip: session revocation tests');

    git('fetch', '-q', 'origin');

    const log = git('log', '--oneline', '--all').trim().split('\n').length;
    const status = git('status', '--porcelain').trim();
    console.log(`demo repository : ${OUT}`);
    console.log(`bare origin     : ${ORIGIN}`);
    console.log(`commits         : ${log} across main, feat/audit-log and origin/*`);
    console.log(`tags            : ${git('tag').trim().split('\n').join(', ')}`);
    console.log(`stashes         : ${git('stash', 'list').trim().split('\n').length}`);
    console.log(`main vs origin  : ${git('rev-list', '--left-right', '--count', 'origin/main...main').trim().replace('\t', ' behind / ')} ahead`);
    console.log(`working tree    : ${status ? 'DIRTY — ' + status : 'clean'}`);
    console.log('\nOpen it in the Extension Development Host (F5), then follow docs/CAPTURE.md.');
}

build();
