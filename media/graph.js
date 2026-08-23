// @ts-check
// Runs in the webview. Also require()-able from node for the pure-function
// self-checks, hence the guards around every browser-only global.

const ROW_H = 26;
const LANE_W = 14;
const COLORS = ['#e05252', '#52a7e0', '#6cc24a', '#e0a852', '#a06ce0', '#52e0c4', '#e052a7', '#8a9199'];

/**
 * Assign each commit a lane and work out which lines to draw through its row.
 * `lanes[i]` holds the hash that lane i is currently waiting to draw.
 *
 * `lanes` is carried in and mutated so a later page of commits continues the
 * lanes the previous page left open: laying out a page at a time then gives the
 * same rows as laying out the whole history at once.
 */
function layout(commits, lanes = []) {
    const rows = [];
    for (const c of commits) {
        const matches = [];
        lanes.forEach((h, i) => { if (h === c.hash) { matches.push(i); } });

        let lane;
        if (matches.length > 0) {
            lane = matches[0];
        } else {
            lane = lanes.indexOf(null);
            if (lane < 0) { lane = lanes.length; }
            lanes[lane] = c.hash;
        }

        // Extra lanes waiting on this same commit collapse into `lane`.
        const mergesIn = matches.slice(1);
        for (const i of mergesIn) { lanes[i] = null; }

        const passThrough = [];
        lanes.forEach((h, i) => {
            if (h !== null && i !== lane) { passThrough.push(i); }
        });

        const parentLanes = [];
        if (c.parents.length === 0) {
            lanes[lane] = null;
        } else {
            lanes[lane] = c.parents[0];
            for (const p of c.parents.slice(1)) {
                let j = lanes.indexOf(p);
                if (j < 0) {
                    j = lanes.indexOf(null);
                    if (j < 0) { j = lanes.length; }
                    lanes[j] = p;
                }
                if (j !== lane) { parentLanes.push(j); }
            }
        }

        rows.push({
            commit: c,
            lane,
            hasTop: matches.length > 0,
            hasBottom: c.parents.length > 0,
            mergesIn,
            parentLanes,
            passThrough,
            width: lanes.length
        });
    }
    return rows;
}

const cx = i => i * LANE_W + LANE_W / 2;
const color = i => COLORS[i % COLORS.length];

function rowSvg(row, maxLanes) {
    const w = maxLanes * LANE_W;
    const mid = ROW_H / 2;
    const x = cx(row.lane);
    let s = `<svg width="${w}" height="${ROW_H}" class="lanes">`;
    for (const i of row.passThrough) {
        s += `<line x1="${cx(i)}" y1="0" x2="${cx(i)}" y2="${ROW_H}" stroke="${color(i)}" stroke-width="2"/>`;
    }
    if (row.hasTop) {
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${mid}" stroke="${color(row.lane)}" stroke-width="2"/>`;
    }
    if (row.hasBottom) {
        s += `<line x1="${x}" y1="${mid}" x2="${x}" y2="${ROW_H}" stroke="${color(row.lane)}" stroke-width="2"/>`;
    }
    for (const i of row.mergesIn) {
        s += `<path d="M ${cx(i)} 0 C ${cx(i)} ${mid}, ${x} 0, ${x} ${mid}" fill="none" stroke="${color(i)}" stroke-width="2"/>`;
    }
    for (const i of row.parentLanes) {
        s += `<path d="M ${x} ${mid} C ${x} ${ROW_H}, ${cx(i)} ${mid}, ${cx(i)} ${ROW_H}" fill="none" stroke="${color(i)}" stroke-width="2"/>`;
    }
    s += `<circle cx="${x}" cy="${mid}" r="4" fill="${color(row.lane)}"/>`;
    return s + '</svg>';
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function refChips(refs) {
    return refs.map(r => {
        const cls = r.startsWith('tag: ') ? 'tag' : r === 'HEAD' ? 'head' : 'branch';
        return `<span class="ref ${cls}">${esc(r.replace('tag: ', ''))}</span>`;
    }).join('');
}

/** Context-menu entries for a commit row. `sep` draws a divider above. */
function commitMenu(commit) {
    const isMerge = commit.parents.length > 1;
    return [
        { action: 'showChanges', label: 'Show Commit Changes' },
        { action: 'compare', label: 'Compare with Working Tree' },
        { action: 'checkout', label: 'Checkout Commit (detached)', sep: true },
        { action: 'branch', label: 'New Branch from Here…' },
        { action: 'tag', label: 'New Tag…' },
        { action: 'reword', label: 'Edit Commit Message…', sep: true },
        { action: 'cherryPick', label: 'Cherry-Pick' },
        { action: 'revert', label: isMerge ? 'Revert Merge (keep first parent)' : 'Revert' },
        { action: 'drop', label: 'Drop Commit…', danger: true },
        { action: 'resetSoft', label: 'Reset Branch Here — Soft', sep: true },
        { action: 'resetMixed', label: 'Reset Branch Here — Mixed' },
        { action: 'resetHard', label: 'Reset Branch Here — Hard', danger: true },
        { action: 'copyHash', label: 'Copy Hash', sep: true },
        { action: 'copyMessage', label: 'Copy Message' }
    ];
}

/** Context-menu entries when more than one commit is selected. */
function multiMenu(count) {
    return [
        { action: 'squash', label: `Squash ${count} Commits into One…` },
        { action: 'drop', label: `Drop ${count} Commits…`, danger: true },
        { action: 'copyHashes', label: 'Copy Hashes', sep: true }
    ];
}

/** Context-menu entries for one changed file in the detail pane. */
function fileMenu(status) {
    return [
        { action: 'openDiff', label: 'Open Diff' },
        { action: 'openWorking', label: 'Open File in Editor' },
        {
            action: 'openAtCommit',
            // A deleted file has no content at this commit, only at its parent.
            label: status === 'D' ? 'Open File Before Deletion' : 'Open File at This Commit'
        },
        { action: 'fileHistory', label: 'Show File History', sep: true },
        { action: 'copyPath', label: 'Copy Path' }
    ];
}

/**
 * Height for the first of two stacked panes while dragging the divider between
 * them. `start` is the top of the pair, `extent` their combined height.
 */
function paneSize(pos, start, extent, min = 56, minOther = 56) {
    return Math.max(min, Math.min(pos - start, extent - minOther));
}

/**
 * Next selection after a click. `index` is the clicked row, `anchor` the row a
 * shift-range extends from. Ctrl/Cmd toggles one row, shift takes a range, a
 * plain click replaces the selection. Returns indices in row order.
 */
function nextSelection(indices, anchor, index, modifiers) {
    if (modifiers.shift && anchor !== null) {
        const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
        const range = [];
        for (let i = from; i <= to; i++) { range.push(i); }
        return { indices: range, anchor };
    }
    if (modifiers.toggle) {
        const next = indices.includes(index)
            ? indices.filter(i => i !== index)
            : [...indices, index].sort((a, b) => a - b);
        // Deselecting everything would leave nothing to act on; keep the click.
        return next.length ? { indices: next, anchor: index } : { indices: [index], anchor: index };
    }
    return { indices: [index], anchor: index };
}

const STATUS_LABEL = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange' };

/**
 * Size for the detail pane while dragging the splitter. `vertical` means the
 * panes are stacked, so the pane is sized by height instead of width. Both the
 * pane and the log keep a minimum, and the pane's minimum wins in a container
 * too small to honour both.
 */
function splitSize(vertical, pos, extent) {
    const [min, minOther] = vertical ? [70, 140] : [180, 260];
    return {
        prop: vertical ? 'height' : 'width',
        clear: vertical ? 'width' : 'height',
        px: Math.max(min, Math.min(extent - pos, extent - minOther))
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        layout, esc, refChips, commitMenu, multiMenu, fileMenu,
        nextSelection, splitSize, paneSize
    };
}

if (typeof acquireVsCodeApi !== 'undefined') {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const graphEl = $('graph');
    const filterEl = $('filter');
    const scopeEl = $('scope');
    const countEl = $('count');
    const branchEl = $('branch');
    const mainEl = $('main');
    const detailEl = $('detail');
    const metaEl = $('dmeta');
    const filesEl = $('dfiles');
    const menuEl = $('ctxmenu');
    const moreEl = $('more');
    const splitterEl = $('splitter');
    const dSplitterEl = $('dsplitter');

    let commits = [];
    /** Lane state carried between pages so appended rows line up. */
    let laneState = [];
    let maxLanes = 1;
    let visibleCount = 0;
    let hasMore = false;
    let loading = false;
    /** Indices into `commits`, in row order. */
    let selection = [];
    let anchor = null;
    let detail = null;
    /** Hash the extension asked us to select, still waiting on its page. */
    let pendingReveal = null;

    const post = (type, payload) => vscode.postMessage({ type, ...payload });
    const selectedHashes = () => selection.map(i => commits[i].hash);

    // ------------------------------------------------------------- graph rows

    function resetGraph() {
        commits = [];
        laneState = [];
        maxLanes = 1;
        visibleCount = 0;
        hasMore = false;
        loading = false;
        graphEl.replaceChildren(moreEl);
        graphEl.scrollTop = 0;
    }

    /**
     * Build and insert rows for one page. Only the new rows touch the DOM —
     * rendering the whole history at once is what makes a big repo crawl.
     */
    function appendCommits(page) {
        const start = commits.length;
        const rows = layout(page, laneState);
        commits = commits.concat(page);

        // Spreading a whole page into Math.max risks the argument limit.
        for (const row of rows) {
            if (row.width > maxLanes) { maxLanes = Math.min(row.width, 20); }
        }
        graphEl.style.setProperty('--lane-width', `${maxLanes * LANE_W}px`);

        const frag = document.createDocumentFragment();
        const created = [];
        rows.forEach((row, i) => {
            const index = start + i;
            const c = row.commit;
            const el = document.createElement('div');
            el.className = 'row';
            el.dataset.hash = c.hash;
            el.dataset.index = index;
            el.dataset.search = `${c.subject} ${c.author} ${c.hash}`.toLowerCase();
            el.innerHTML =
                rowSvg(row, maxLanes) +
                `<span class="subject">${refChips(c.refs)}${esc(c.subject)}</span>` +
                `<span class="author">${esc(c.author)}</span>` +
                `<span class="ago">${esc(c.ago)}</span>` +
                `<span class="hash" title="Click to copy">${c.hash.substring(0, 8)}</span>`;
            el.addEventListener('click', e => {
                selectAt(index, { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey });
                if (e.target.classList.contains('hash')) {
                    post('action', { action: 'copyHash', hash: c.hash });
                }
            });
            el.addEventListener('dblclick', () => post('action', { action: 'showChanges', hash: c.hash }));
            el.addEventListener('contextmenu', e => {
                e.preventDefault();
                // Right-clicking outside the selection acts on that row alone,
                // the way file lists behave everywhere else.
                if (!selection.includes(index)) { selectAt(index, {}); }
                openMenu(e.clientX, e.clientY);
            });
            created.push(el);
            frag.appendChild(el);
        });
        graphEl.insertBefore(frag, moreEl);
        // The selection cannot have changed by appending, so no markSelected here.
        filterNewRows(created);
    }

    // ---------------------------------------------------------------- paging

    function requestMore() {
        if (loading || !hasMore) { return; }
        loading = true;
        updateFooter();
        post('loadMore', {});
    }

    function updateFooter() {
        moreEl.classList.toggle('clickable', hasMore && !loading);
        moreEl.textContent = loading
            ? 'Loading more commits…'
            : hasMore
                ? `${commits.length} commits loaded — scroll or click to load more`
                : commits.length
                    ? `end of history — ${commits.length} commits`
                    : '';
    }

    /**
     * Select a commit asked for from outside (a blame annotation). It may sit
     * past the loaded pages, so keep paging towards it until it turns up or the
     * history runs out.
     */
    function tryReveal() {
        if (pendingReveal === null) { return; }
        const i = commits.findIndex(c => c.hash === pendingReveal);
        if (i < 0) {
            if (hasMore) {
                countEl.textContent = `looking for ${pendingReveal.substring(0, 8)}…`;
                requestMore();
            } else {
                countEl.textContent = `${pendingReveal.substring(0, 8)} is not in this branch's history`;
                pendingReveal = null;
            }
            return;
        }
        pendingReveal = null;
        filterEl.value = '';   // a filter could be hiding the row
        applyFilter();
        selectAt(i, {});
        const el = graphEl.querySelector(`.row[data-index="${i}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); }
    }

    moreEl.addEventListener('click', requestMore);
    graphEl.addEventListener('scroll', () => {
        // Start the next page before the user reaches the bottom.
        if (graphEl.scrollTop + graphEl.clientHeight >= graphEl.scrollHeight - 400) {
            requestMore();
        }
    });

    function markSelected() {
        graphEl.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'));
        for (const i of selection) {
            const el = graphEl.querySelector(`.row[data-index="${i}"]`);
            if (el) { el.classList.add('selected'); }
        }
    }

    function selectAt(index, modifiers) {
        const next = nextSelection(selection, anchor, index, modifiers);
        selection = next.indices;
        anchor = next.anchor;
        markSelected();
        detail = null;
        if (selection.length === 1) {
            metaEl.innerHTML = '<div class="placeholder">Loading…</div>';
            filesEl.innerHTML = '';
            post('select', { hash: commits[selection[0]].hash });
        } else {
            renderMultiDetail();
        }
    }

    /** Keep only selections that survived a reload, and never end up with none. */
    function reconcileSelection(previousHashes) {
        const byHash = new Map(commits.map((c, i) => [c.hash, i]));
        selection = previousHashes.map(h => byHash.get(h)).filter(i => i !== undefined);
        anchor = selection.length ? selection[0] : null;
        if (!selection.length && commits.length) {
            selectAt(0, {});
        } else if (selection.length === 1) {
            post('select', { hash: commits[selection[0]].hash });
        } else {
            renderMultiDetail();
        }
    }

    // ----------------------------------------------------------- detail panel

    function renderDetail() {
        if (!detail) {
            metaEl.innerHTML = '<div class="placeholder">Select a commit.</div>';
            filesEl.innerHTML = '';
            return;
        }
        const d = detail;
        const parents = d.parents
            .map(p => `<a class="link parent" data-hash="${p}">${p.substring(0, 8)}</a>`)
            .join(' ') || '<span class="dim">none (root commit)</span>';

        metaEl.innerHTML = `
            <div class="dsubject">${refChips(d.refs)}${esc(d.subject)}</div>
            ${d.body ? `<pre class="dbody">${esc(d.body)}</pre>` : ''}
            <dl>
                <dt>Commit</dt><dd><a class="link" id="dhash">${esc(d.hash)}</a></dd>
                <dt>Author</dt><dd>${esc(d.author)} &lt;${esc(d.email)}&gt; · ${esc(d.ago)}</dd>
                ${d.committer !== d.author ? `<dt>Committer</dt><dd>${esc(d.committer)}</dd>` : ''}
                <dt>Date</dt><dd>${esc(d.dateText)}</dd>
                <dt>Parents</dt><dd>${parents}</dd>
            </dl>`;

        filesEl.innerHTML =
            `<div class="fhead">${d.files.length} changed file${d.files.length === 1 ? '' : 's'}</div>` +
            (d.files.length
                ? d.files.map(f => `
                    <div class="file" data-path="${esc(f.path)}" data-old="${esc(f.oldPath || '')}" data-status="${esc(f.status)}">
                        <span class="st st-${f.status}" title="${STATUS_LABEL[f.status] || f.status}">${f.status}</span>
                        <span class="fpath">${esc(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}</span>
                    </div>`).join('')
                : '<div class="placeholder">No file changes.</div>');

        const fileArgs = el => ({
            hash: d.hash,
            path: el.dataset.path,
            oldPath: el.dataset.old || undefined,
            status: el.dataset.status
        });
        const selectFile = el => {
            filesEl.querySelectorAll('.file.selected').forEach(f => f.classList.remove('selected'));
            el.classList.add('selected');
        };
        filesEl.querySelectorAll('.file').forEach(el => {
            el.addEventListener('click', () => {
                selectFile(el);
                post('openFile', fileArgs(el));
            });
            el.addEventListener('contextmenu', e => {
                e.preventDefault();
                selectFile(el);
                openFileContextMenu(e.clientX, e.clientY, fileArgs(el));
            });
        });
        metaEl.querySelectorAll('.parent').forEach(el =>
            el.addEventListener('click', () => {
                const i = commits.findIndex(c => c.hash === el.dataset.hash);
                if (i >= 0) { selectAt(i, {}); }
            }));
        const dh = $('dhash');
        if (dh) { dh.addEventListener('click', () => post('action', { action: 'copyHash', hash: d.hash })); }
    }

    /** Summary shown instead of commit details while several rows are selected. */
    function renderMultiDetail() {
        const picked = selection.map(i => commits[i]);
        metaEl.innerHTML = `
            <div class="dsubject">${picked.length} commits selected</div>
            <p class="dim">Right-click to squash them into one. Squashing needs them
            consecutive in history, with no merge commit among them.</p>`;
        filesEl.innerHTML =
            '<div class="fhead">newest first</div>' +
            picked.map(c => `
                <div class="file">
                    <span class="st shash">${c.hash.substring(0, 7)}</span>
                    <span class="fpath ltr">${esc(c.subject)}</span>
                </div>`).join('');
    }

    // ------------------------------------------------------------ context menu

    /** Render `items` at (x, y) and post `send(action)` when one is picked. */
    function showMenu(x, y, items, send) {
        menuEl.innerHTML = items.map(m =>
            `<div class="mi${m.sep ? ' sep' : ''}${m.danger ? ' danger' : ''}" data-action="${m.action}">${esc(m.label)}</div>`
        ).join('');
        menuEl.querySelectorAll('.mi').forEach(el =>
            el.addEventListener('click', () => {
                closeMenu();
                send(el.dataset.action);
            }));
        menuEl.style.display = 'block';
        // Keep the menu inside the viewport when opened near an edge.
        const r = menuEl.getBoundingClientRect();
        menuEl.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
        menuEl.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
    }

    function openMenu(x, y) {
        const hashes = selectedHashes();
        const items = hashes.length > 1 ? multiMenu(hashes.length) : commitMenu(commits[selection[0]]);
        showMenu(x, y, items, action => post('action', { action, hash: hashes[0], hashes }));
    }

    function openFileContextMenu(x, y, file) {
        showMenu(x, y, fileMenu(file.status), action => post('fileAction', { action, ...file }));
    }

    const closeMenu = () => { menuEl.style.display = 'none'; };
    window.addEventListener('click', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); } });
    window.addEventListener('scroll', closeMenu, true);

    // ----------------------------------------------------------------- filter

    const query = () => filterEl.value.toLowerCase().trim();

    function filterRow(el, q) {
        const show = !q || el.dataset.search.includes(q);
        el.classList.toggle('hidden', !show);
        return show;
    }

    function updateCount() {
        // Filtering only searches what has been loaded, so say so while paging.
        const scope = hasMore ? ' loaded' : '';
        countEl.textContent = query()
            ? `${visibleCount} / ${commits.length}${scope}`
            : `${commits.length}${scope} commits`;
        updateFooter();
    }

    /** Full pass. Only for a changed query — appending must not re-scan the lot. */
    function applyFilter() {
        const q = query();
        visibleCount = 0;
        graphEl.querySelectorAll('.row').forEach(el => {
            if (filterRow(el, q)) { visibleCount++; }
        });
        updateCount();
    }

    /** Incremental pass over one page, so appending stays O(page), not O(all). */
    function filterNewRows(rowEls) {
        const q = query();
        for (const el of rowEls) {
            if (filterRow(el, q)) { visibleCount++; }
        }
        updateCount();
    }

    filterEl.addEventListener('input', applyFilter);
    scopeEl.addEventListener('change', () => post('scope', { scope: scopeEl.value }));

    document.querySelectorAll('#toolbar button[data-action]').forEach(b =>
        b.addEventListener('click', () => {
            const hashes = selectedHashes();
            post('action', { action: b.dataset.action, hash: hashes[0], hashes });
        }));

    // --------------------------------------------------------------- splitter

    let dragging = null;
    splitterEl.addEventListener('mousedown', e => { dragging = 'outer'; e.preventDefault(); });
    dSplitterEl.addEventListener('mousedown', e => { dragging = 'inner'; e.preventDefault(); });
    window.addEventListener('mouseup', () => { dragging = null; });
    window.addEventListener('mousemove', e => {
        if (dragging === 'outer') {
            const vertical = getComputedStyle(mainEl).flexDirection === 'column';
            const { prop, clear, px } = splitSize(
                vertical,
                vertical ? e.clientY : e.clientX,
                vertical ? window.innerHeight : window.innerWidth
            );
            // Drop the other axis so a size set before the layout flipped is not kept.
            detailEl.style[clear] = '';
            detailEl.style[prop] = `${px}px`;
        } else if (dragging === 'inner') {
            // Split the commit message against the file list, inside the pane.
            const box = detailEl.getBoundingClientRect();
            metaEl.style.height = `${paneSize(e.clientY, box.top, box.height)}px`;
            metaEl.style.flex = '0 0 auto';
        }
    });

    // ------------------------------------------------------------- extension

    window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'commits') {
            const previous = selectedHashes();
            resetGraph();
            hasMore = !!msg.hasMore;
            appendCommits(msg.commits);
            // A rewrite (squash, reword, rebase) replaces hashes, so the previous
            // selection may no longer exist.
            reconcileSelection(previous);
            markSelected();
        } else if (msg.type === 'commitsAppend') {
            loading = false;
            hasMore = !!msg.hasMore;
            appendCommits(msg.commits);
            tryReveal();
        } else if (msg.type === 'detail') {
            if (selection.length === 1 && msg.detail.hash === commits[selection[0]].hash) {
                detail = msg.detail;
                renderDetail();
            }
        } else if (msg.type === 'reveal') {
            pendingReveal = msg.hash;
            tryReveal();
        } else if (msg.type === 'refs') {
            const current = scopeEl.value;
            scopeEl.innerHTML =
                '<option value="">All branches</option>' +
                msg.refs.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
            scopeEl.value = msg.scope || current || '';
            branchEl.textContent = msg.branch ? `on ${msg.branch}` : 'detached HEAD';
        } else if (msg.type === 'error') {
            countEl.textContent = msg.message;
        }
    });

    post('ready', {});
}
