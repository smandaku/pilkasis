'use strict';

function sanitizePostgrestSearch(keyword) {
    return String(keyword || '')
        .replace(/[%_,.()"'\\]/g, '')
        .trim();
}

function applyVoterFilters(query, opts = {}) {
    const keyword = opts.keyword !== undefined ? opts.keyword : voterSearchKeyword;
    const voterType = opts.voterType !== undefined ? opts.voterType : activeVoterType;
    const classFilter = opts.classFilter !== undefined ? opts.classFilter : voterClassFilter;
    const kw = sanitizePostgrestSearch(keyword);
    if (kw) query = query.or(`nama.ilike.%${kw}%,id.ilike.%${kw}%`);
    if (voterType === 'siswa' && classFilter) {
        query = query.eq('kelas', classFilter);
    }
    return query;
}

function compareTextNumeric(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'id', { numeric: true, sensitivity: 'base' });
}

function sortVoterRecords(records, voterType) {
    const sorted = [...records];
    if (voterType === 'siswa') {
        sorted.sort((a, b) => {
            const byKelas = compareTextNumeric(a.kelas, b.kelas);
            if (byKelas !== 0) return byKelas;
            return compareTextNumeric(a.nama, b.nama);
        });
    } else {
        sorted.sort((a, b) => compareTextNumeric(a.nama, b.nama));
    }
    return sorted;
}

async function fetchAllRows(tableName, selectCols, applyFiltersFn) {
    const PAGE_SIZE = 1000;
    const all = [];
    let from = 0;
    for (; ;) {
        let query = db.from(tableName).select(selectCols).range(from, from + PAGE_SIZE - 1);
        if (typeof applyFiltersFn === 'function') query = applyFiltersFn(query);
        const { data, error } = await query;
        if (error) throw error;
        const chunk = data || [];
        all.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return all;
}

async function fetchAllVotersFiltered(opts = {}) {
    const voterType = opts.voterType || activeVoterType;
    const tableName = 'pemilih_' + voterType;
    const selectCols = voterType === 'siswa' ? DB_SELECT.VOTER_SISWA : DB_SELECT.VOTER_OTHER;
    const filterOpts = {
        voterType,
        keyword: opts.keyword !== undefined ? opts.keyword : voterSearchKeyword,
        classFilter: opts.classFilter !== undefined ? opts.classFilter : voterClassFilter
    };
    const rows = await fetchAllRows(tableName, selectCols, (query) => applyVoterFilters(query, filterOpts));
    return sortVoterRecords(rows, voterType);
}

async function loadVoterData(forceRefresh = false) {
    const tbody = document.getElementById('voterTableBody');
    const typeAtStart = activeVoterType;
    const loadId = ++voterLoadSeq;
    const cacheKey = 'voters_' + typeAtStart;

    if (!forceRefresh && !voterSearchKeyword && !voterClassFilter) {
        const cached = getCachedJson(cacheKey, CACHE_TTL_MS.voters);
        if (cached && cached.allRecords) {
            if (loadId !== voterLoadSeq || activeVoterType !== typeAtStart) return;
            voterTotalRecords = cached.total ?? cached.allRecords.length;
            const totalPages = Math.ceil(voterTotalRecords / voterLimitPerPage) || 1;
            if (voterCurrentPage > totalPages) voterCurrentPage = totalPages;
            if (voterCurrentPage < 1) voterCurrentPage = 1;
            const pageOffset = (voterCurrentPage - 1) * voterLimitPerPage;
            voterPageRecords = cached.allRecords.slice(pageOffset, pageOffset + voterLimitPerPage);
            renderVoterClassFilterOptions();
            renderVoterTable();
            return;
        }
    }

    if (tbody) {
        const colSpan = typeAtStart === 'siswa' ? 8 : 7;
        tbody.innerHTML = `
                    <tr>
                        <td colspan="${colSpan}" class="py-10 text-gray-400">
                            <i class="fas fa-spinner animate-spin text-2xl mb-2 block"></i>
                            Memuat data ${typeAtStart}...
                        </td>
                    </tr>
                `;
    }
    try {
        const tableName = 'pemilih_' + typeAtStart;
        const selectCols = typeAtStart === 'siswa' ? DB_SELECT.VOTER_SISWA : DB_SELECT.VOTER_OTHER;
        const applyFiltersForType = (query) => applyVoterFilters(query, {
            voterType: typeAtStart,
            keyword: voterSearchKeyword,
            classFilter: voterClassFilter
        });
        const rows = await fetchAllRows(tableName, selectCols, applyFiltersForType);
        if (loadId !== voterLoadSeq || activeVoterType !== typeAtStart) return;
        const sortedRecords = sortVoterRecords((rows || []).map(row => ({ ...row })), typeAtStart);
        voterTotalRecords = sortedRecords.length;
        const totalPages = Math.ceil(voterTotalRecords / voterLimitPerPage) || 1;
        if (voterCurrentPage > totalPages) voterCurrentPage = totalPages;
        if (voterCurrentPage < 1) voterCurrentPage = 1;
        const pageOffset = (voterCurrentPage - 1) * voterLimitPerPage;
        voterPageRecords = sortedRecords.slice(pageOffset, pageOffset + voterLimitPerPage);
        if (!voterSearchKeyword && !voterClassFilter) {
            setCachedJson(cacheKey, { allRecords: sortedRecords, total: voterTotalRecords });
        } else {
            clearCachedJson(cacheKey);
        }
        renderVoterClassFilterOptions();
        renderVoterTable();
    } catch (error) {
        if (loadId !== voterLoadSeq || activeVoterType !== typeAtStart) return;
        console.error("Error loading voter data:", error);
        if (tbody) {
            const colSpan = typeAtStart === 'siswa' ? 8 : 7;
            tbody.innerHTML = `
                        <tr>
                            <td colspan="${colSpan}" class="py-10 text-red-500 font-bold">
                                <i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>
                                Gagal memuat data. Periksa koneksi atau izin Supabase.
                            </td>
                        </tr>
                    `;
        }
    }
}
function invalidateVoterClassFilter() {
    const selectEl = document.getElementById('voterFilterKelas');
    if (selectEl) selectEl.dataset.loaded = '0';
}

function renderVoterClassFilterOptions() {
    const selectEl = document.getElementById('voterFilterKelas');
    if (!selectEl) return;
    const filterContainer = document.getElementById('kelasFilterContainer');
    if (activeVoterType !== 'siswa') {
        if (filterContainer) filterContainer.style.display = 'none';
        return;
    }
    if (filterContainer) filterContainer.style.display = 'block';
    if (selectEl.dataset.loaded === '1' && selectEl.options.length > 1) return;
    fetchAllRows('pemilih_siswa', 'kelas').then((rows) => {
        const uniqueClasses = [...new Set((rows || [])
            .map(v => v.kelas)
            .filter(c => c && c.trim() !== "")
        )];
        uniqueClasses.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const prevValue = voterClassFilter;
        selectEl.innerHTML = '<option value="">-- Semua Kelas --</option>';
        uniqueClasses.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.textContent = cls;
            if (cls === prevValue) opt.selected = true;
            selectEl.appendChild(opt);
        });
        selectEl.dataset.loaded = '1';
    }).catch((err) => console.error('Gagal memuat filter kelas:', err));
}
function renderVoterTable() {
    const tbody = document.getElementById('voterTableBody');
    if (!tbody) return;
    const paginatedRecords = voterPageRecords;
    const totalRecords = voterTotalRecords;
    const totalPages = Math.ceil(totalRecords / voterLimitPerPage) || 1;
    if (voterCurrentPage > totalPages) voterCurrentPage = totalPages;
    if (voterCurrentPage < 1) voterCurrentPage = 1;
    const pageOffset = (voterCurrentPage - 1) * voterLimitPerPage;
    const startDisplay = totalRecords > 0 ? pageOffset + 1 : 0;
    const endDisplay = totalRecords > 0 ? Math.min(pageOffset + paginatedRecords.length, totalRecords) : 0;
    const infoEl = document.getElementById('voterTableInfo');
    if (infoEl) {
        if (totalRecords > 0) {
            infoEl.textContent = `Menampilkan ${startDisplay}-${endDisplay} dari ${totalRecords} data`;
        } else {
            infoEl.textContent = `Menampilkan 0-0 dari 0 data`;
        }
    }
    if (paginatedRecords.length === 0) {
        tbody.innerHTML = `
                    <tr>
                        <td colspan="${activeVoterType === 'siswa' ? 8 : 7}" class="py-10 text-gray-500 text-center">
                            Tidak ada data pemilih ditemukan.
                        </td>
                    </tr>
                `;
    } else {
        let html = '';
        paginatedRecords.forEach((record, index) => {
            const rowNumber = pageOffset + index + 1;
            const genderLabel = record.jenis_kelamin === 'L' ? 'Laki-Laki' : (record.jenis_kelamin === 'P' ? 'Perempuan' : (record.jenis_kelamin || '0'));
            const votingStatusHtml = record.sudah_memilih == 1 || record.sudah_memilih === true ?
                `<span class="text-green-600 font-bold"><i class="fas fa-check-circle mr-1"></i> Sudah Memilih</span>` :
                `<span class="text-red-600 font-semibold"><i class="fas fa-times-circle mr-1"></i> Belum Memilih</span>`;
            const defaultPass = activeVoterType === 'siswa' ? 'siswa123' : (activeVoterType === 'guru' ? 'guru123' : 'staf123');
            const voterPassword = record.password || defaultPass;
            html += `
                        <tr class="hover:bg-slate-50 border-b border-gray-100 transition-colors">
                            <td class="py-3 px-3 border border-gray-200 text-center font-medium text-gray-500">${rowNumber}</td>
                            <td class="py-3 px-3 border border-gray-200 text-center font-mono font-semibold">${escapeHtml(displayOrZero(record.id))}</td>
                            <td class="py-3 px-3 border border-gray-200 text-left font-medium text-gray-800" data-full-name="${escapeHtmlAttr(record.nama)}">${escapeHtml(formatDisplayName(record.nama) || '0')}</td>
                            ${activeVoterType === 'siswa' ? `<td class="py-3 px-3 border border-gray-200 text-center">${escapeHtml(displayOrZero(record.kelas))}</td>` : ''}
                            <td class="py-3 px-3 border border-gray-200 text-center">${escapeHtml(genderLabel)}</td>
                            <td class="py-3 px-3 border border-gray-200 text-center font-mono relative">
                                <span class="voter-password-display">${VOTER_PASSWORD_MASK}</span>
                                <button type="button" data-table-action="toggle-password" data-password="${escapeHtmlAttr(voterPassword)}" class="ml-1.5 text-gray-400 hover:text-sky-600 focus:outline-none" title="Tampilkan/Sembunyikan Sandi">
                                    <i class="fas fa-eye text-xs"></i>
                                </button>
                            </td>
                            <td class="py-3 px-3 border border-gray-200 text-center">${votingStatusHtml}</td>
                            <td class="py-3 px-3 border border-gray-200 text-center whitespace-nowrap">
                                <button type="button" data-table-action="edit-voter" data-record-id="${escapeHtmlAttr(record.id)}" class="text-sky-600 hover:text-sky-800 font-semibold mr-2 transition-colors">Edit</button>
                                <button type="button" data-table-action="reset-voter" data-record-id="${escapeHtmlAttr(record.id)}" data-record-name="${escapeHtmlAttr(record.nama)}" class="text-amber-600 hover:text-amber-800 font-semibold mr-2 transition-colors" title="Reset suara agar bisa memilih ulang">Reset</button>
                                <button type="button" data-table-action="delete-voter" data-record-id="${escapeHtmlAttr(record.id)}" data-record-name="${escapeHtmlAttr(record.nama)}" class="text-rose-500 hover:text-rose-700 font-semibold transition-colors">Hapus</button>
                            </td>
                        </tr>
                    `;
        });
        tbody.innerHTML = html;
    }
    if (typeof updateMobileFormattedNames === 'function') updateMobileFormattedNames();
    syncVoterClassColumn();
    renderVoterPagination(totalPages);
}
function renderVoterPagination(totalPages) {
    const container = document.getElementById('voterPagination');
    if (!container) return;
    let html = '';
    if (voterCurrentPage > 1) {
        html += `<button onclick="changeVoterPage(${voterCurrentPage - 1})" class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-slate-50 transition-colors">&laquo; Prev</button>`;
    } else {
        html += `<button disabled class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed">&laquo; Prev</button>`;
    }
    const startPage = Math.max(1, voterCurrentPage - 2);
    const endPage = Math.min(totalPages, voterCurrentPage + 2);
    if (startPage > 1) {
        html += `<button onclick="changeVoterPage(1)" class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-slate-50 transition-colors">1</button>`;
        if (startPage > 2) html += `<span class="px-1 text-gray-500">...</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
        if (i === voterCurrentPage) {
            html += `<button class="px-2.5 py-1 text-xs font-bold rounded border border-sky-600 bg-sky-600 text-white shadow-sm">${i}</button>`;
        } else {
            html += `<button onclick="changeVoterPage(${i})" class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-slate-50 transition-colors">${i}</button>`;
        }
    }
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="px-1 text-gray-500">...</span>`;
        html += `<button onclick="changeVoterPage(${totalPages})" class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-slate-50 transition-colors">${totalPages}</button>`;
    }
    if (voterCurrentPage < totalPages) {
        html += `<button onclick="changeVoterPage(${voterCurrentPage + 1})" class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-slate-50 transition-colors">Next &raquo;</button>`;
    } else {
        html += `<button disabled class="px-2.5 py-1 text-xs font-semibold rounded border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed">Next &raquo;</button>`;
    }
    container.innerHTML = html;
}
function changeVoterPage(page) {
    voterCurrentPage = page;
    loadVoterData(true);
}
function changeVoterLimit(val) {
    if (val === 'all') {
        voterLimitPerPage = Number.MAX_SAFE_INTEGER;
    } else {
        voterLimitPerPage = parseInt(val, 10) || 10;
    }
    voterCurrentPage = 1;
    loadVoterData(true);
}
function filterVoterByKelas(cls) {
    voterClassFilter = cls;
    voterCurrentPage = 1;
    const selectEl = document.getElementById('voterFilterKelas');
    if (selectEl) selectEl.dataset.loaded = '0';
    loadVoterData(true);
}
function searchVoter(val) {
    voterSearchKeyword = val;
    voterCurrentPage = 1;
    clearTimeout(voterSearchDebounceTimer);
    voterSearchDebounceTimer = setTimeout(() => loadVoterData(true), 350);
}
function openVoterModal(action = 'add', voterId = '') {
    const modal = document.getElementById('voterModal');
    const titleEl = document.getElementById('voterModalTitle');
    const form = document.getElementById('voterForm');
    const idInput = document.getElementById('voterIdInput');
    const nameInput = document.getElementById('voterNameInput');
    const classInput = document.getElementById('voterClassInput');
    const jkInput = document.getElementById('voterJkInput');
    const passwordInput = document.getElementById('voterPasswordInput');
    const actionTypeInput = document.getElementById('voterActionType');
    const classContainer = document.getElementById('voterClassInputContainer');
    const lblId = document.getElementById('lblVoterId');
    if (!modal || !form) return;

    modalVoterType = activeVoterType;
    const typeAtOpen = modalVoterType;
    const seq = ++voterModalSeq;
    const typeLabel = typeAtOpen === 'siswa' ? 'Siswa' : (typeAtOpen === 'guru' ? 'Guru' : 'Staf');

    if (typeAtOpen === 'siswa') {
        lblId.textContent = 'NIS';
        if (classContainer) classContainer.style.display = 'block';
    } else if (typeAtOpen === 'guru') {
        lblId.textContent = 'NIP';
        if (classContainer) classContainer.style.display = 'none';
    } else if (typeAtOpen === 'staf') {
        lblId.textContent = 'Kode Staf';
        if (classContainer) classContainer.style.display = 'none';
    }
    form.reset();
    actionTypeInput.value = action;
    if (action === 'add') {
        titleEl.textContent = `Tambah Data ${typeLabel}`;
        idInput.disabled = false;
        idInput.classList.remove('opacity-60', 'cursor-not-allowed');
        if (passwordInput) passwordInput.value = "";
    } else {
        titleEl.textContent = `Edit Data ${typeLabel}`;
        idInput.disabled = true;
        idInput.classList.add('opacity-60', 'cursor-not-allowed');
        idInput.value = voterId;
        const tableName = 'pemilih_' + typeAtOpen;
        const selectCols = typeAtOpen === 'siswa' ? DB_SELECT.VOTER_SISWA : DB_SELECT.VOTER_OTHER;
        db.from(tableName).select(selectCols).eq('id', voterId).single().then(({ data: record, error }) => {
            if (seq !== voterModalSeq) return;
            if (error || !record) {
                showAlert('Gagal memuat data pemilih. Data mungkin sudah dihapus.', false);
                closeVoterModal();
                return;
            }
            nameInput.value = record.nama || "";
            if (typeAtOpen === 'siswa') classInput.value = record.kelas || "";
            jkInput.value = record.jenis_kelamin || "L";
            if (passwordInput) passwordInput.value = record.password || "";
        });
    }
    if (passwordInput) {
        passwordInput.type = "password";
        const formIcon = document.getElementById('voterFormPasswordIcon');
        if (formIcon) formIcon.className = "fas fa-eye text-xs";
    }
    modal.classList.add('active');
}
function closeVoterModal() {
    voterModalSeq++;
    const modal = document.getElementById('voterModal');
    if (modal) modal.classList.remove('active');
}
async function saveVoter(e) {
    e.preventDefault();
    if (savingVoter) return;
    const action = document.getElementById('voterActionType').value;
    const voterId = document.getElementById('voterIdInput').value.trim();
    const name = document.getElementById('voterNameInput').value.trim();
    const kelas = document.getElementById('voterClassInput').value.trim();
    const jk = document.getElementById('voterJkInput').value;
    let password = document.getElementById('voterPasswordInput') ? document.getElementById('voterPasswordInput').value.trim() : '';
    if (!voterId || !name) return;
    const voterType = modalVoterType || activeVoterType;
    const tableName = 'pemilih_' + voterType;
    const defaultPass = voterType === 'siswa' ? 'siswa123' : (voterType === 'guru' ? 'guru123' : 'staf123');
    savingVoter = true;
    const submitBtn = e.target && e.target.querySelector
        ? e.target.querySelector('button[type="submit"]')
        : null;
    if (submitBtn) submitBtn.disabled = true;
    try {
        const saveData = {
            id: voterId,
            nama: name,
            jenis_kelamin: jk,
            updated_at: new Date().toISOString()
        };
        if (voterType === 'siswa') {
            saveData.kelas = kelas;
            saveData.nis = voterId;
        } else if (voterType === 'guru') {
            saveData.nip = voterId;
        } else if (voterType === 'staf') {
            saveData.kode = voterId;
        }

        if (action === 'add') {
            if (!password) password = defaultPass;
            saveData.password = password;
            const { data: existing, error: existErr } = await db.from(tableName).select('id').eq('id', voterId).maybeSingle();
            if (existErr) throw existErr;
            if (existing) {
                alert(`ID ${voterId} sudah terdaftar! Gunakan ID yang lain.`);
                return;
            }
            saveData.sudah_memilih = 0;
            const { error } = await db.from(tableName).insert(saveData);
            if (error) throw error;
        } else {
            const { id, ...updateData } = saveData;
            if (password) updateData.password = password;
            const { error } = await db.from(tableName).update(updateData).eq('id', voterId);
            if (error) throw error;
        }
        showAlert(`Data berhasil disimpan!`, true);
        closeVoterModal();
        clearCachedJson('voters_' + voterType);
        if (voterType === 'siswa') {
            invalidateVoterClassFilter();
            if (activeVoterType === 'siswa') renderVoterClassFilterOptions();
        }
        if (activeVoterType === voterType) loadVoterData(true);
    } catch (err) {
        console.error("Error saving voter:", err);
        showAlert(`Gagal menyimpan data: ${err.message}`, false);
    } finally {
        savingVoter = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}
function deleteVoter(voterId, voterName) {
    const voterType = activeVoterType;
    showModal(
        "Hapus Data",
        `Apakah Anda yakin ingin menghapus data pemilih <strong>${escapeHtml(voterName)}</strong> (${escapeHtml(voterId)})?`,
        true,
        "Hapus",
        async () => {
            try {
                const { data: delRes, error: delErr } = await db.rpc('delete_voter_and_logs', {
                    p_session_token: getAdminSessionToken(),
                    p_voter_type: voterType,
                    p_voter_id: voterId
                });
                if (delErr) throw delErr;
                if (delRes && delRes.success === false) {
                    throw new Error(delRes.error || 'Gagal menghapus pemilih');
                }
                showAlert(`Data ${voterName} berhasil dihapus!`, true);
                clearCachedJson('voters_' + voterType);
                clearCachedJson('candidates_data');
                if (voterType === 'siswa') invalidateVoterClassFilter();
                if (activeVoterType === voterType) loadVoterData(true);
            } catch (err) {
                console.error("Error deleting voter:", err);
                showAlert(`Gagal menghapus data: ${err.message}`, false);
            }
        }
    );
}

function resetVoterVotes(voterId, voterName) {
    const voterType = activeVoterType;
    showModal(
        "Reset Suara Pemilih",
        `Reset suara <strong>${escapeHtml(voterName)}</strong> (${escapeHtml(voterId)})?<br><br>Status akan menjadi <strong>Belum Memilih</strong> dan pemilih dapat memilih ulang. Suara sebelumnya akan dihapus dari hasil.`,
        true,
        "Reset",
        async () => {
            try {
                const { data: resetRes, error: resetErr } = await db.rpc('reset_voter_votes', {
                    p_session_token: getAdminSessionToken(),
                    p_voter_type: voterType,
                    p_voter_id: voterId
                });
                if (resetErr) throw resetErr;
                if (resetRes && resetRes.success === false) {
                    throw new Error(resetRes.error || 'Gagal mereset suara pemilih');
                }
                showAlert(`Suara ${voterName} berhasil direset. Pemilih dapat memilih ulang.`, true);
                clearCachedJson('voters_' + voterType);
                clearCachedJson('candidates_data');
                if (activeVoterType === voterType) loadVoterData(true);
                if (typeof updateDashboard === 'function' && activeAdminView === 'dashboard') {
                    updateDashboard();
                }
            } catch (err) {
                console.error("Error resetting voter votes:", err);
                showAlert(`Gagal mereset suara: ${err.message}`, false);
            }
        }
    );
}

function handleExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (importingExcel) {
        showAlert('Impor Excel masih berjalan. Tunggu hingga selesai.', false);
        event.target.value = '';
        return;
    }
    const typeAtStart = activeVoterType;
    importingExcel = true;
    showAlert("Sedang mengurai file Excel...", true);
    const reader = new FileReader();
    reader.onload = async function (e) {
        let uploadedCount = 0;
        try {
            const data = new Uint8Array(e.target.result);

            const workbook = XLSX.read(data, { type: 'array', cellText: true, raw: false });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' });
            if (jsonData.length === 0) {
                showAlert("File Excel kosong atau format tidak sesuai!", false);
                return;
            }
            showAlert(`Menemukan ${jsonData.length} baris data. Sedang mengunggah ke database...`, true);
            const tableName = 'pemilih_' + typeAtStart;

            const normalizeIdCell = (val) => {
                if (val == null || val === '') return '';
                if (typeof val === 'number') {
                    if (Number.isSafeInteger(val)) return String(val);

                    return val.toLocaleString('fullwide', { useGrouping: false });
                }
                let s = String(val).trim();
                if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
                return s;
            };

            const defaultPass = typeAtStart === 'siswa' ? 'siswa123' : (typeAtStart === 'guru' ? 'guru123' : 'staf123');

            const existingRows = await fetchAllRows(tableName, 'id,sudah_memilih,password');
            const existingVoteMap = new Map((existingRows || []).map(r => [String(r.id), r.sudah_memilih]));
            const existingPassMap = new Map((existingRows || []).map(r => [String(r.id), r.password || '']));

            const records = [];
            for (const row of jsonData) {
                const cleanRow = {};
                Object.keys(row).forEach(key => {
                    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
                    cleanRow[cleanKey] = row[key];
                });
                const idVal = normalizeIdCell(
                    cleanRow.id
                    || cleanRow.nis
                    || cleanRow.nip
                    || cleanRow.kode
                    || cleanRow.kode_staf
                    || ""
                );
                const namaVal = String(cleanRow.nama || cleanRow.name || "").trim();
                const kelasVal = String(cleanRow.kelas || cleanRow.class || "").trim();
                let passwordVal = cleanRow.password !== undefined
                    ? String(cleanRow.password).trim()
                    : (cleanRow.sandi !== undefined ? String(cleanRow.sandi).trim() : "");

                if (!passwordVal) {
                    passwordVal = existingPassMap.has(idVal) ? existingPassMap.get(idVal) : defaultPass;
                }
                let jkVal = String(
                    cleanRow.jenis_kelamin
                    || cleanRow['jenis_kelamin_(l/p)']
                    || cleanRow.jk
                    || cleanRow.gender
                    || ""
                ).trim().toUpperCase();
                if (jkVal.startsWith('L') || jkVal === 'LAKI-LAKI') jkVal = 'L';
                else if (jkVal.startsWith('P') || jkVal === 'PEREMPUAN') jkVal = 'P';
                else jkVal = 'L';
                if (!idVal || !namaVal) {
                    console.warn("Melewati baris data karena ID atau Nama kosong:", row);
                    continue;
                }
                const recordData = {
                    id: idVal,
                    nama: namaVal,
                    jenis_kelamin: jkVal,
                    sudah_memilih: existingVoteMap.has(idVal) ? existingVoteMap.get(idVal) : 0,
                    password: passwordVal,
                    updated_at: new Date().toISOString()
                };
                if (typeAtStart === 'siswa') {
                    recordData.kelas = kelasVal;
                    recordData.nis = idVal;
                } else if (typeAtStart === 'guru') {
                    recordData.nip = idVal;
                } else if (typeAtStart === 'staf') {
                    recordData.kode = idVal;
                }
                records.push(recordData);
            }

            const dedupedMap = new Map();
            for (const rec of records) dedupedMap.set(String(rec.id), rec);
            const uniqueRecords = Array.from(dedupedMap.values());
            const dupCount = records.length - uniqueRecords.length;

            if (uniqueRecords.length > 0) {
                showAlert(`Mengunggah ${uniqueRecords.length} data ${typeAtStart} secara massal...`, true);

                const CHUNK_SIZE = 500;
                for (let i = 0; i < uniqueRecords.length; i += CHUNK_SIZE) {
                    const chunk = uniqueRecords.slice(i, i + CHUNK_SIZE);
                    const { error } = await db.from(tableName).upsert(chunk);
                    if (error) throw error;
                    uploadedCount += chunk.length;
                }
                clearCachedJson('voters_' + typeAtStart);
                if (typeAtStart === 'siswa') {
                    invalidateVoterClassFilter();
                    if (activeVoterType === 'siswa') renderVoterClassFilterOptions();
                }
                if (activeVoterType === typeAtStart) loadVoterData(true);
                const dupNote = dupCount > 0 ? ` (${dupCount} baris ID ganda digabung)` : '';
                showAlert(`Berhasil mengunggah ${uniqueRecords.length} data ${typeAtStart} secara massal!${dupNote}`, true);
            } else {
                showAlert("Tidak ada baris data valid yang diunggah.", false);
            }
        } catch (err) {
            console.error("Error importing excel:", err);
            if (uploadedCount > 0) {
                clearCachedJson('voters_' + typeAtStart);
                if (typeAtStart === 'siswa') invalidateVoterClassFilter();
                if (activeVoterType === typeAtStart) loadVoterData(true);
                showAlert(`Impor terhenti setelah ${uploadedCount} baris tersimpan. Error: ${err.message}`, false);
            } else {
                showAlert(`Gagal mengimpor file Excel: ${err.message}`, false);
            }
        } finally {
            importingExcel = false;
            const inputEl = document.getElementById('excelFileInput');
            if (inputEl) inputEl.value = '';
        }
    };
    reader.onerror = function () {
        importingExcel = false;
        showAlert('Gagal membaca file Excel.', false);
        const inputEl = document.getElementById('excelFileInput');
        if (inputEl) inputEl.value = '';
    };
    reader.readAsArrayBuffer(file);
}
function downloadExcelTemplate() {
    const wb = XLSX.utils.book_new();
    let data = [];
    if (activeVoterType === 'siswa') {
        data = [
            { "NIS": "26270101", "Nama": "Ahmad Budiman", "Kelas": "X IPA 1", "Jenis Kelamin (L/P)": "L", "Password": "siswa123" },
            { "NIS": "26270102", "Nama": "Siti Nurhaliza", "Kelas": "XI IPS 2", "Jenis Kelamin (L/P)": "P", "Password": "siswa123" }
        ];
    } else if (activeVoterType === 'guru') {
        data = [
            { "NIP": "198503112010011002", "Nama": "Drs. H. Mulyono, M.Pd.", "Jenis Kelamin (L/P)": "L", "Password": "guru123" },
            { "NIP": "199008242015022003", "Nama": "Sari Wahyuni, S.Pd.", "Jenis Kelamin (L/P)": "P", "Password": "guru123" }
        ];
    } else if (activeVoterType === 'staf') {
        data = [
            { "Kode": "STF001", "Nama": "Rian Ardiansyah", "Jenis Kelamin (L/P)": "L", "Password": "staf123" },
            { "Kode": "STF002", "Nama": "Diana Lestari", "Jenis Kelamin (L/P)": "P", "Password": "staf123" }
        ];
    }
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Template " + activeVoterType.toUpperCase());
    XLSX.writeFile(wb, `Template_Import_${activeVoterType.toUpperCase()}.xlsx`);
    showAlert("Berhasil mengunduh template Excel!", true);
}
async function downloadVoterCardsPdf() {
    if (generatingVoterCards) return;
    const btnCard = document.querySelector('button[title="Download Kartu"]');
    const restoreBtn = () => {
        if (!btnCard) return;
        btnCard.disabled = false;
        btnCard.classList.remove('opacity-60', 'cursor-not-allowed');
    };

    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
        showAlert('Library PDF belum termuat. Muat ulang halaman lalu coba lagi.', false);
        return;
    }
    if (typeof QRious === 'undefined') {
        showAlert('Library QR belum termuat. Muat ulang halaman lalu coba lagi.', false);
        return;
    }

    const typeAtStart = activeVoterType;
    const keywordAtStart = voterSearchKeyword;
    const classAtStart = voterClassFilter;

    let filteredRecords = [];
    try {
        filteredRecords = await fetchAllVotersFiltered({
            voterType: typeAtStart,
            keyword: keywordAtStart,
            classFilter: classAtStart
        });
    } catch (e) {
        console.error(e);
        showAlert('Gagal memuat data pemilih untuk PDF.', false);
        return;
    }
    if (filteredRecords.length === 0) {
        showAlert('Tidak ada data pemilih untuk dicetak kartu!', false);
        return;
    }

    generatingVoterCards = true;
    if (btnCard) {
        btnCard.disabled = true;
        btnCard.classList.add('opacity-60', 'cursor-not-allowed');
    }
    showAlert(`Sedang mempersiapkan ${filteredRecords.length} kartu PDF...`, true);

    const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));

    const preloadImage = (url) => new Promise((resolve) => {
        if (!url) return resolve(null);
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => finish(img);
        img.onerror = () => finish(null);
        setTimeout(() => finish(null), 8000);
        img.src = url;
    });

    const imageToDataUrl = (img, mime = 'image/png') => {
        try {
            if (!img) return null;
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) return null;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL(mime);
        } catch (e) {
            return null;
        }
    };

    try {
        const ballotBoxUrl = 'https://iili.io/Cu7VhhJ.png';
        const ballotBoxImg = await preloadImage(ballotBoxUrl);
        let ballotBoxDataUrl = imageToDataUrl(ballotBoxImg, 'image/png');

        let logoDataUrl = null;
        try {
            const { data: cfg, error: cfgErr } = await db
                .from('pengaturan')
                .select('school_logo')
                .eq('id', 'konfigurasi_aplikasi')
                .single();
            if (cfgErr) throw cfgErr;
            const logoRef = (cfg && cfg.school_logo)
                || AppStorage.get('ep_sh_logo')
                || DEFAULT_SYSTEM_SETTINGS.schoolLogo;
            if (cfg && cfg.school_logo) {
                AppStorage.set('ep_sh_logo', cfg.school_logo);
            }
            const resolvedLogo = await resolveImage(logoRef);
            if (resolvedLogo) {
                if (resolvedLogo.startsWith('data:')) {
                    logoDataUrl = resolvedLogo;
                } else {
                    const logoImg = await preloadImage(resolvedLogo);
                    logoDataUrl = imageToDataUrl(logoImg, 'image/png') || imageToDataUrl(logoImg, 'image/jpeg');
                }
            }
        } catch (e) {
            console.warn('Gagal memuat school_logo dari pengaturan:', e);
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const kartuLebar = 85.6;
        const kartuTinggi = 50;
        const marginX = 8;
        const marginY = 6;
        const posXAwal = 15.4;
        const posYAwal = 10;
        let posX = posXAwal;
        let posY = posYAwal;
        let col = 0;
        let rowCount = 0;

        const VOTER_APP_BASE_URL = getVoterAppBaseUrl();
        const schoolName = getConfiguredSchoolName();
        const buildVoterLoginQrUrl = (voterId, password) => {
            const url = new URL('open.html', VOTER_APP_BASE_URL);
            if (voterId) url.searchParams.set('id', String(voterId).trim());
            if (password) url.searchParams.set('p', String(password));
            url.searchParams.set('src', 'qr');
            return url.toString();
        };

        const qrCanvas = document.createElement('canvas');
        const CHUNK = 20;

        for (let idx = 0; idx < filteredRecords.length; idx++) {
            const record = filteredRecords[idx];
            const defaultPass = typeAtStart === 'siswa' ? 'siswa123' : (typeAtStart === 'guru' ? 'guru123' : 'staf123');
            const voterPassword = record.password || defaultPass;

            let qrDataUrl = null;
            try {
                const qr = new QRious({
                    element: qrCanvas,
                    value: buildVoterLoginQrUrl(record.id, voterPassword),
                    size: 128,
                    level: 'M',
                    background: '#ffffff',
                    foreground: '#000000'
                });
                qrDataUrl = qr.toDataURL('image/png');
            } catch (err) {
                console.error('QR Code generation failed for ID:', record.id, err);
            }

            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(34, 102, 170);
            doc.setLineWidth(0.3);
            doc.roundedRect(posX, posY, kartuLebar, kartuTinggi, 3, 3, 'FD');
            doc.setFillColor(34, 102, 170);
            doc.roundedRect(posX, posY, kartuLebar, 14, 3, 3, 'F');
            doc.rect(posX, posY + 7, kartuLebar, 7, 'F');

            if (logoDataUrl) {
                try {
                    const fmt = logoDataUrl.indexOf('image/jpeg') >= 0 || logoDataUrl.indexOf('image/jpg') >= 0 ? 'JPEG' : 'PNG';
                    doc.addImage(logoDataUrl, fmt, posX + 3, posY + 2, 10, 10);
                } catch (e) { }
            }

            let addedBallotBox = false;
            if (ballotBoxDataUrl) {
                try {
                    doc.addImage(ballotBoxDataUrl, 'PNG', posX + kartuLebar - 14, posY + 1.5, 11, 11);
                    addedBallotBox = true;
                } catch (e) {
                    addedBallotBox = false;
                }
            }
            if (!addedBallotBox) {
                const boxX = posX + kartuLebar - 14;
                const boxY = posY + 1.5;
                const boxW = 11;
                const boxH = 11;
                doc.setDrawColor(255, 255, 255);
                doc.setFillColor(34, 102, 170);
                doc.setLineWidth(0.4);
                doc.rect(boxX + 1.1, boxY + 4.4, boxW - 2.2, boxH - 5.5, 'FD');
                doc.rect(boxX, boxY + 3.3, boxW, 1.3, 'FD');
                doc.setDrawColor(34, 102, 170);
                doc.setLineWidth(0.3);
                doc.line(boxX + 2.2, boxY + 3.9, boxX + boxW - 2.2, boxY + 3.9);
                doc.setFillColor(255, 255, 255);
                doc.setDrawColor(255, 255, 255);
                doc.rect(boxX + 3.5, boxY + 0.5, boxW - 7, 2.8, 'FD');
                doc.setDrawColor(220, 50, 50);
                doc.setLineWidth(0.3);
                doc.line(boxX + 4.6, boxY + 2.0, boxX + 5.3, boxY + 2.6);
                doc.line(boxX + 5.3, boxY + 2.6, boxX + 6.4, boxY + 1.1);
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.5);
            doc.setTextColor(255, 255, 255);
            doc.text('KARTU PEMILIHAN', posX + kartuLebar / 2, posY + 5.5, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.text(schoolName, posX + kartuLebar / 2, posY + 10, { align: 'center' });

            const labelX = posX + 5;
            const valX = labelX + 16;
            let textY = posY + 20;
            const drawDataRow = (label, value, valueColor = [10, 10, 10], isBold = true) => {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 100, 100);
                doc.setFontSize(7.5);
                doc.text(label, labelX, textY);
                doc.text(':', labelX + 13, textY);
                doc.setFont('helvetica', isBold ? 'bold' : 'normal');
                doc.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
                doc.setFontSize(8);
                const lines = doc.splitTextToSize(String(value ?? '-'), 36);
                for (let li = 0; li < lines.length; li++) {
                    doc.text(lines[li], valX, textY);
                    if (li < lines.length - 1) textY += 3.5;
                }
                textY += 4.5;
            };

            drawDataRow('Nama', record.nama || '-', [10, 10, 10], true);
            const idLabel = typeAtStart === 'siswa' ? 'NIS' : (typeAtStart === 'guru' ? 'NIP' : 'Kode Staf');
            drawDataRow(idLabel, record.id, [10, 10, 10], true);
            if (typeAtStart === 'siswa') {
                drawDataRow('Kelas', record.kelas || '-', [10, 10, 10], true);
            }
            drawDataRow('Password', voterPassword, [220, 50, 50], true);

            if (qrDataUrl) {
                const qrSize = 18;
                const qrX = posX + kartuLebar - qrSize - 4;
                const qrY = posY + 15.5;
                doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(5.5);
                doc.setTextColor(34, 102, 170);
                doc.text('Scan Otomatis', qrX + qrSize / 2, qrY + qrSize + 1.6, { align: 'center' });
            }

            doc.setFont('helvetica', 'italic');
            doc.setTextColor(120, 120, 120);
            doc.setFontSize(6.5);
            doc.text('Web : smandaku.github.io/pilkasis', posX + kartuLebar / 2, posY + kartuTinggi - 7, { align: 'center' });
            doc.setFillColor(34, 102, 170);
            doc.roundedRect(posX, posY + kartuTinggi - 3, kartuLebar, 3, 3, 3, 'F');
            doc.rect(posX, posY + kartuTinggi - 3, kartuLebar, 1.5, 'F');

            col++;
            if (col === 2) {
                col = 0;
                rowCount++;
                posX = posXAwal;
                posY += kartuTinggi + marginY;
            } else {
                posX += kartuLebar + marginX;
            }
            if (rowCount === 5 && idx < filteredRecords.length - 1) {
                doc.addPage();
                posX = posXAwal;
                posY = posYAwal;
                col = 0;
                rowCount = 0;
            }

            if ((idx + 1) % CHUNK === 0) {
                showAlert(`Menyusun kartu ${idx + 1}/${filteredRecords.length}...`, true);
                await yieldToUi();
            }
        }

        doc.save(`Kartu_Pemilih_${typeAtStart.toUpperCase()}.pdf`);
        showAlert(`Berhasil mengunduh ${filteredRecords.length} Kartu Pemilih PDF!`, true);
    } catch (err) {
        console.error('Download kartu PDF gagal:', err);
        showAlert('Gagal membuat PDF kartu: ' + (err.message || 'error tidak dikenal'), false);
    } finally {
        generatingVoterCards = false;
        restoreBtn();
    }
}

async function resetAllVoterStatus() {
    if (bulkDestructiveBusy) {
        showAlert('Operasi massal masih berjalan. Tunggu hingga selesai.', false);
        return;
    }
    showModal(
        "Reset Hasil Voting",
        "Apakah Anda yakin ingin menghapus semua hasil voting? Status semua pemilih (siswa, guru, staf) akan di-reset menjadi <strong>Belum Memilih</strong> dan perolehan suara semua kandidat akan dikembalikan ke <strong>0</strong>.",
        true,
        "Reset",
        async () => {
            if (bulkDestructiveBusy) return;
            bulkDestructiveBusy = true;
            try {
                showAlert("Sedang mereset status voting...", true);

                const { data: resetRes, error: resetErr } = await db.rpc('reset_all_votes', {
                    p_session_token: getAdminSessionToken()
                });
                if (resetErr) throw resetErr;
                if (resetRes && resetRes.success === false) {
                    throw new Error(resetRes.error || 'Gagal mereset hasil voting');
                }

                ['siswa', 'guru', 'staf'].forEach(t => clearCachedJson('voters_' + t));
                clearCachedJson('candidates_data');
                const resetCount = Number((resetRes && resetRes.reset_count) || 0);
                showAlert(`Berhasil mereset ${resetCount} pemilih dan seluruh perolehan suara kandidat!`, true);
                if (typeof loadVoterData === 'function' && activeAdminView === 'pemilih') loadVoterData(true);
                if (typeof updateDashboard === 'function' && activeAdminView === 'dashboard') updateDashboard();

            } catch (err) {
                console.error("Error resetting voting status:", err);
                showAlert(`Gagal mereset status voting: ${err.message}`, false);
            } finally {
                bulkDestructiveBusy = false;
            }
        }
    );
}
function getVoterTypeLabel(voterType) {
    if (voterType === 'siswa') return 'Siswa';
    if (voterType === 'guru') return 'Guru';
    return 'Staf';
}

async function deleteAllVotersByType() {
    const voterType = activeVoterType;
    if (!voterType || !['siswa', 'guru', 'staf'].includes(voterType)) {
        showAlert('Tipe pemilih tidak valid.', false);
        return;
    }
    if (bulkDestructiveBusy) {
        showAlert('Operasi massal masih berjalan. Tunggu hingga selesai.', false);
        return;
    }
    const typeLabel = getVoterTypeLabel(voterType);
    showModal(
        `Hapus Data ${typeLabel}`,
        `Apakah Anda yakin ingin menghapus <strong>seluruh data ${typeLabel.toLowerCase()}</strong>? Suara dari pemilih ${typeLabel.toLowerCase()} juga akan dihapus dari perolehan kandidat. Tindakan ini tidak dapat dibatalkan.`,
        true,
        'Hapus Data',
        async () => {
            if (bulkDestructiveBusy) return;
            bulkDestructiveBusy = true;
            try {
                showAlert(`Sedang menghapus data ${typeLabel.toLowerCase()}...`, true);

                const { data: clearRes, error: clearErr } = await db.rpc('clear_voters_by_type', {
                    p_session_token: getAdminSessionToken(),
                    p_voter_type: voterType
                });
                if (clearErr) throw clearErr;
                if (clearRes && clearRes.success === false) {
                    throw new Error(clearRes.error || `Gagal menghapus data ${typeLabel.toLowerCase()}`);
                }

                clearCachedJson('voters_' + voterType);
                clearCachedJson('candidates_data');
                if (voterType === 'siswa') invalidateVoterClassFilter();
                Object.keys(AppStorage.memoryData).forEach(key => {
                    if (key.startsWith('img_') || key === 'voters_' + voterType || key === 'candidates_data') {
                        delete AppStorage.memoryData[key];
                    }
                });

                const deleteCount = Number((clearRes && clearRes.deleted) || 0);
                showAlert(`Berhasil menghapus ${deleteCount} data ${typeLabel.toLowerCase()}!`, true);
                if (typeof loadVoterData === 'function' && activeAdminView === 'pemilih') {
                    loadVoterData(true);
                }
                if (typeof updateDashboard === 'function' && activeAdminView === 'dashboard') {
                    updateDashboard();
                }

            } catch (err) {
                console.error(`Error deleting ${voterType} data:`, err);
                showAlert(`Gagal menghapus data ${typeLabel.toLowerCase()}: ${err.message}`, false);
            } finally {
                bulkDestructiveBusy = false;
            }
        }
    );
}

async function clearAllVoterData() {
    if (bulkDestructiveBusy) {
        showAlert('Operasi massal masih berjalan. Tunggu hingga selesai.', false);
        return;
    }
    showModal(
        "Kosongkan Database",
        "Apakah Anda yakin ingin menghapus seluruh data pada database.? Data admin dan pengaturan aplikasi <strong>TIDAK</strong> akan terhapus. Tindakan ini tidak dapat dibatalkan.",
        true,
        "Kosongkan",
        async () => {
            if (bulkDestructiveBusy) return;
            bulkDestructiveBusy = true;
            try {
                showAlert("Sedang mengosongkan database...", true);

                const { data: clearRes, error: clearErr } = await db.rpc('clear_all_voters', {
                    p_session_token: getAdminSessionToken()
                });
                if (clearErr) throw clearErr;
                if (clearRes && clearRes.success === false) {
                    throw new Error(clearRes.error || 'Gagal mengosongkan database');
                }

                ['siswa', 'guru', 'staf'].forEach(t => clearCachedJson('voters_' + t));
                clearCachedJson('candidates_data');
                invalidateVoterClassFilter();
                Object.keys(AppStorage.memoryData).forEach(key => {
                    if (key.startsWith('img_') || key.startsWith('voters_') || key === 'candidates_data')
                        delete AppStorage.memoryData[key];
                });

                const deleteCount = Number((clearRes && clearRes.deleted) || 0);
                showAlert(`Berhasil menghapus seluruh data database (${deleteCount} total baris data)! Data akun admin dan pengaturan aplikasi tetap aman.`, true);
                if (typeof loadVoterData === 'function' && activeAdminView === 'pemilih') {
                    loadVoterData(true);
                }
                if (typeof loadCandidates === 'function' && activeAdminView === 'kandidat') {
                    loadCandidates(true);
                }
                if (typeof updateDashboard === 'function' && activeAdminView === 'dashboard') {
                    updateDashboard();
                }

            } catch (err) {
                console.error("Error clearing database:", err);
                showAlert(`Gagal mengosongkan database: ${err.message}`, false);
            } finally {
                bulkDestructiveBusy = false;
            }
        }
    );
}
