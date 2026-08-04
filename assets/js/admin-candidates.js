'use strict';

async function updateDashboard() {
    const btnRefresh = document.querySelector('button[title="Muat ulang data dashboard (manual)"]');
    if (btnRefresh) {
        btnRefresh.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        btnRefresh.disabled = true;
    }
    try {
        let candidates = [];
        const voterTypes = ['siswa', 'guru', 'staf'];
        let stats = {
            total: 0, masuk: 0, belum: 0,
            partisipasi: {
                siswa: { total: 0, masuk: 0, belum: 0 },
                guru: { total: 0, masuk: 0, belum: 0 },
                staf: { total: 0, masuk: 0, belum: 0 }
            }
        };

        const { data: rpcData, error: rpcError } = await db.rpc('get_dashboard_stats', {
            p_session_token: getAdminSessionToken()
        });
        if (rpcError || !rpcData) {
            throw rpcError || new Error('Gagal memuat statistik dashboard');
        }
        if (rpcData.success === false) {
            throw new Error(rpcData.error || 'Sesi admin tidak valid');
        }
        candidates = rpcData.candidates || [];
        stats.total = numOrZero(rpcData.total);
        stats.masuk = numOrZero(rpcData.masuk);
        stats.belum = numOrZero(rpcData.belum);
        if (rpcData.partisipasi) {
            voterTypes.forEach(vType => {
                const src = rpcData.partisipasi[vType] || {};
                stats.partisipasi[vType] = {
                    total: numOrZero(src.total),
                    masuk: numOrZero(src.masuk),
                    belum: numOrZero(src.belum)
                };
            });
        }

        candidates = (candidates || []).map(c => ({
            ...c,
            nama: displayOrZero(c.nama),
            posisi: displayOrZero(c.posisi),
            nomor_urut: displayOrZero(c.nomor_urut),
            kelas: displayOrZero(c.kelas),
            suara_siswa: numOrZero(c.suara_siswa),
            suara_guru: numOrZero(c.suara_guru),
            suara_staf: numOrZero(c.suara_staf),
            total_suara: numOrZero(c.total_suara != null ? c.total_suara : (numOrZero(c.suara_siswa) + numOrZero(c.suara_guru) + numOrZero(c.suara_staf)))
        }));

        const pcn = stats.total > 0 ? ((stats.masuk / stats.total) * 100).toFixed(0) : 0;
        document.getElementById('stat-total').textContent = numOrZero(stats.total);
        document.getElementById('stat-masuk').textContent = numOrZero(stats.masuk);
        document.getElementById('stat-belum').textContent = numOrZero(stats.belum);
        document.getElementById('stat-persen').textContent = pcn + '%';
        const tPartBody = document.getElementById('tabel-partisipasi-body');
        if (tPartBody) {
            tPartBody.innerHTML = '';
            const typesMap = { 'siswa': 'Siswa', 'guru': 'Guru', 'staf': 'Staf' };
            let htmlPart = '';
            for (const vType of voterTypes) {
                const s = stats.partisipasi[vType] || { total: 0, masuk: 0, belum: 0 };
                const total = numOrZero(s.total);
                const masuk = numOrZero(s.masuk);
                const belum = numOrZero(s.belum);
                const pct = total > 0 ? ((masuk / total) * 100).toFixed(0) : 0;
                htmlPart += `
                            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                <td class="py-3 px-3 border-x border-gray-100 font-semibold text-center">${typesMap[vType]}</td>
                                <td class="py-3 px-3 border-x border-gray-100 text-center">${total}</td>
                                <td class="py-3 px-3 border-x border-gray-100 text-center text-emerald-600 font-bold">${masuk}</td>
                                <td class="py-3 px-3 border-x border-gray-100 text-center text-rose-500 font-bold">${belum}</td>
                                <td class="py-3 px-3 border-x border-gray-100 text-center font-bold text-sky-600">${pct}%</td>
                            </tr>
                        `;
            }
            htmlPart += `
                        <tr class="border-t-2 border-slate-200">
                            <td class="py-3 px-3 border-x border-[#2980b9] text-center font-bold bg-[#2980b9] text-white">TOTAL</td>
                            <td class="py-3 px-3 border-x border-[#3498db] text-center font-bold bg-[#3498db] text-white">${numOrZero(stats.total)}</td>
                            <td class="py-3 px-3 border-x border-[#3498db] text-center font-bold bg-[#3498db] text-white">${numOrZero(stats.masuk)}</td>
                            <td class="py-3 px-3 border-x border-[#3498db] text-center font-bold bg-[#3498db] text-white">${numOrZero(stats.belum)}</td>
                            <td class="py-3 px-3 border-x border-[#3498db] text-center font-bold bg-[#3498db] text-white">${pcn}%</td>
                        </tr>
                    `;
            tPartBody.innerHTML = htmlPart;
        }
        const tRinciBody = document.getElementById('tabel-rinci-body');
        if (tRinciBody) {
            if (candidates.length === 0) {
                tRinciBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="py-8 text-gray-500 text-center">Belum ada data kandidat.</td>
                    </tr>`;
            } else {
                candidates.sort((a, b) => {
                    const posA = a.posisi || "";
                    const posB = b.posisi || "";
                    if (posA !== posB) {
                        const orderMap = { "Ketua Umum OSIS": 1, "Ketua 2 OSIS": 2, "Ketua Umum DPK": 3, "Ketua 2 DPK": 4 };
                        const wa = orderMap[posA] || 99;
                        const wb2 = orderMap[posB] || 99;
                        if (wa !== wb2) return wa - wb2;
                        return posA.localeCompare(posB);
                    }
                    const numA = parseInt(a.nomor_urut) || 0;
                    const numB = parseInt(b.nomor_urut) || 0;
                    return numA - numB;
                });
                let htmlRinci = '';
                candidates.forEach(c => {
                    htmlRinci += `
                                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                    <td class="py-3 px-3 border-x border-gray-100 text-center font-bold">${escapeHtml(displayOrZero(c.nomor_urut))}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-left font-semibold">${escapeHtml(displayOrZero(c.nama))}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-left">${escapeHtml(displayOrZero(c.posisi))}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center">${numOrZero(c.suara_siswa)}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center">${numOrZero(c.suara_guru)}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center">${numOrZero(c.suara_staf)}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center font-bold text-emerald-600">${numOrZero(c.total_suara)}</td>
                                </tr>
                            `;
                });
                tRinciBody.innerHTML = htmlRinci;
            }
        }
        const tPemenangBody = document.getElementById('tabel-pemenang-body');
        if (tPemenangBody) {
            if (candidates.length === 0) {
                tPemenangBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="py-8 text-gray-500 text-center">Belum ada data kandidat.</td>
                    </tr>`;
            } else {
                let maxVotes = {};
                candidates.forEach(c => {
                    if (maxVotes[c.posisi] === undefined || c.total_suara > maxVotes[c.posisi]) {
                        maxVotes[c.posisi] = c.total_suara;
                    }
                });

                let winners = {};
                candidates.forEach(c => {
                    if (c.total_suara === maxVotes[c.posisi]) {
                        if (!winners[c.posisi]) winners[c.posisi] = [];
                        winners[c.posisi].push(c);
                    }
                });

                let htmlPemenang = '';
                const orderMap = { "Ketua Umum OSIS": 1, "Ketua 2 OSIS": 2, "Ketua Umum DPK": 3, "Ketua 2 DPK": 4 };
                Object.keys(winners).sort((a, b) => {
                    const wa = orderMap[a] || 99;
                    const wb = orderMap[b] || 99;
                    if (wa !== wb) return wa - wb;
                    return a.localeCompare(b);
                }).forEach(pos => {
                    const wArr = winners[pos];
                    const total = numOrZero(maxVotes[pos]);

                    let names = "";
                    let kelasStr = "";
                    let noUrutStr = "";

                    if (total === 0) {
                        names = "0";
                        kelasStr = "0";
                        noUrutStr = "0";
                    } else {
                        names = wArr.map(w => escapeHtml(displayOrZero(w.nama))).join(" <span class='text-gray-400 font-normal mx-1'>&amp;</span> ");
                        kelasStr = wArr.map(w => escapeHtml(displayOrZero(w.kelas))).join(" / ");
                        noUrutStr = wArr.map(w => escapeHtml(displayOrZero(w.nomor_urut))).join(" / ");
                    }

                    htmlPemenang += `
                                <tr class="border-b border-gray-100 hover:bg-amber-50 transition-colors">
                                    <td class="py-3 px-3 border-x border-gray-100 font-bold text-slate-700 text-center">${noUrutStr}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 font-bold text-slate-700 text-left">${escapeHtml(displayOrZero(pos))}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 font-bold text-amber-600 text-left">
                                        ${total > 0 ? '<i class="fas fa-medal mr-1"></i>' : ''} ${names}
                                    </td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center">${kelasStr}</td>
                                    <td class="py-3 px-3 border-x border-gray-100 text-center font-bold text-emerald-600">${total} Suara</td>
                                </tr>
                            `;
                });
                tPemenangBody.innerHTML = htmlPemenang;
            }
        }
    } catch (err) {
        console.error("Error updating dashboard:", err);
        showAlert("Gagal memuat data dashboard: " + err.message, false);
        document.getElementById('stat-total').textContent = '0';
        document.getElementById('stat-masuk').textContent = '0';
        document.getElementById('stat-belum').textContent = '0';
        document.getElementById('stat-persen').textContent = '0%';
        const tPartBody = document.getElementById('tabel-partisipasi-body');
        if (tPartBody) {
            tPartBody.innerHTML = `
                <tr><td class="py-3 px-3 border-x border-gray-100 text-center">Siswa</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0%</td></tr>
                <tr><td class="py-3 px-3 border-x border-gray-100 text-center">Guru</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0%</td></tr>
                <tr><td class="py-3 px-3 border-x border-gray-100 text-center">Staf</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0</td><td class="py-3 px-3 border-x border-gray-100 text-center">0%</td></tr>
                <tr><td class="py-3 px-3 text-center font-bold bg-[#2980b9] text-white">TOTAL</td><td class="py-3 px-3 text-center font-bold bg-[#3498db] text-white">0</td><td class="py-3 px-3 text-center font-bold bg-[#3498db] text-white">0</td><td class="py-3 px-3 text-center font-bold bg-[#3498db] text-white">0</td><td class="py-3 px-3 text-center font-bold bg-[#3498db] text-white">0%</td></tr>`;
        }
        const tRinciBody = document.getElementById('tabel-rinci-body');
        if (tRinciBody) {
            tRinciBody.innerHTML = `<tr><td colspan="7" class="py-8 text-gray-500 text-center">Belum ada data kandidat.</td></tr>`;
        }
        const tPemenangBody = document.getElementById('tabel-pemenang-body');
        if (tPemenangBody) {
            tPemenangBody.innerHTML = `<tr><td colspan="5" class="py-8 text-gray-500 text-center">Belum ada data kandidat.</td></tr>`;
        }
    } finally {
        if (btnRefresh) {
            btnRefresh.innerHTML = '<i class="fas fa-sync-alt"></i> <span class="hidden sm:inline">Refresh</span>';
            btnRefresh.disabled = false;
        }
    }
}
async function loadCandidateData(forceRefresh = false) {
    const tbody = document.getElementById('candidateTableBody');
    const loadId = ++candidateLoadSeq;

    if (!forceRefresh) {
        const cached = getCachedJson('candidates_data', CACHE_TTL_MS.candidates);
        if (cached) {
            if (loadId !== candidateLoadSeq) return;
            allCandidateRecords = Array.isArray(cached) ? cached : [];
            if (loadId !== candidateLoadSeq) return;
            renderCandidateTable();
            return;
        }
    }

    if (tbody) {
        tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="py-10 text-gray-400 text-center">
                            <i class="fas fa-spinner animate-spin text-2xl mb-2 block"></i>
                            Memuat data kandidat...
                        </td>
                    </tr>
                `;
    }
    try {
        const { data: rows, error } = await db.from('kandidat').select(DB_SELECT.KANDIDAT_LIST);
        if (error) throw error;
        if (loadId !== candidateLoadSeq) return;
        allCandidateRecords = rows || [];
        allCandidateRecords.sort((a, b) => {
            const kelasA = a.kelas || "";
            const kelasB = b.kelas || "";
            if (kelasA !== kelasB) {
                return kelasA.localeCompare(kelasB, undefined, { numeric: true, sensitivity: 'base' });
            }
            const posA = a.posisi || "";
            const posB = b.posisi || "";
            if (posA !== posB) {
                const orderMap = { "Ketua Umum OSIS": 1, "Ketua 2 OSIS": 2, "Ketua Umum DPK": 3, "Ketua 2 DPK": 4 };
                const wa = orderMap[posA] || 99;
                const wb = orderMap[posB] || 99;
                if (wa !== wb) return wa - wb;
                return posA.localeCompare(posB);
            }
            const numA = parseInt(a.nomor_urut) || 0;
            const numB = parseInt(b.nomor_urut) || 0;
            return numA - numB;
        });
        setCachedJson('candidates_data', allCandidateRecords);
        renderCandidateTable();
    } catch (error) {
        if (loadId !== candidateLoadSeq) return;
        console.error("Error loading candidate data:", error);
        if (tbody) {
            tbody.innerHTML = `
                        <tr>
                            <td colspan="9" class="py-10 text-red-500 font-bold text-center">
                                <i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>
                                Gagal memuat data kandidat. Periksa koneksi/izin Supabase.
                            </td>
                        </tr>
                    `;
        }
    }
}
async function renderCandidateTable() {
    const tbody = document.getElementById('candidateTableBody');
    if (!tbody) return;
    const renderId = ++candidateRenderSeq;
    const snapshot = allCandidateRecords.slice();
    if (snapshot.length === 0) {
        if (renderId !== candidateRenderSeq) return;
        tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="py-10 text-gray-500 text-center">
                            Belum ada data kandidat yang ditambahkan.
                        </td>
                    </tr>
                `;
        return;
    }
    let html = '';
    for (let i = 0; i < snapshot.length; i++) {
        if (renderId !== candidateRenderSeq) return;
        const record = snapshot[i];
        let fotoHtml = '<i class="text-gray-400 text-xs">(Belum ada foto)</i>';
        if (record.foto) {
            const fotoSrc = await resolveImage(record.foto);
            if (renderId !== candidateRenderSeq) return;
            if (fotoSrc) {
                fotoHtml = `<img src="${escapeHtmlAttr(fotoSrc)}" alt="${escapeHtmlAttr(record.nama)}" class="w-full max-w-[120px] h-auto object-cover rounded-lg mx-auto shadow-sm">`;
            }
        }

        let formattedMisi = '<i>(Belum diisi)</i>';
        if (record.misi) {
            const lines = record.misi.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            const listItems = lines.map(line => {

                const cleanLine = line.replace(/^(\d+[\.\)]\s*|[\-\•]\s*)/, '');
                return `<li class="mb-1">${escapeHtml(cleanLine)}</li>`;
            }).join('');
            formattedMisi = `<ol class="list-decimal pl-4 m-0">${listItems}</ol>`;
        }

        const visiHtml = `<div class="text-left leading-relaxed whitespace-pre-wrap break-words">${record.visi ? escapeHtml(record.visi) : '<i>(Belum diisi)</i>'}</div>`;
        const misiHtml = `<div class="text-left leading-relaxed break-words">${formattedMisi}</div>`;
        html += `
                    <tr class="hover:bg-slate-50 border-b border-gray-100 transition-colors">
                        <td class="py-3 px-3 border border-gray-200 text-center font-semibold text-gray-600 whitespace-nowrap">${i + 1}</td>
                        <td class="py-3 px-3 border border-gray-200 text-center font-bold text-gray-700 whitespace-nowrap">${escapeHtml(displayOrZero(record.nomor_urut))}</td>
                        <td class="py-3 px-3 border border-gray-200 text-left font-medium text-gray-800 whitespace-nowrap">${escapeHtml(displayOrZero(record.posisi))}</td>
                        <td class="py-3 px-3 border border-gray-200 text-left font-semibold text-sky-700 whitespace-nowrap">${escapeHtml(displayOrZero(record.nama))}</td>
                        <td class="py-3 px-3 border border-gray-200 text-center whitespace-nowrap">${escapeHtml(displayOrZero(record.kelas))}</td>
                        <td class="py-3 px-3 border border-gray-200 text-left align-top min-w-[200px]">${visiHtml}</td>
                        <td class="py-3 px-3 border border-gray-200 text-left align-top min-w-[200px]">${misiHtml}</td>
                        <td class="py-3 px-3 border border-gray-200 text-center whitespace-nowrap">${fotoHtml}</td>
                        <td class="py-3 px-3 border border-gray-200 text-center whitespace-nowrap">
                            <button type="button" data-table-action="edit-candidate" data-record-id="${escapeHtmlAttr(record.id)}" class="text-sky-600 hover:text-sky-800 font-semibold mr-3 transition-colors">Edit</button>
                            <button type="button" data-table-action="delete-candidate" data-record-id="${escapeHtmlAttr(record.id)}" data-record-name="${escapeHtmlAttr(record.nama)}" class="text-rose-500 hover:text-rose-700 font-semibold transition-colors">Hapus</button>
                        </td>
                    </tr>
                `;
    }
    if (renderId !== candidateRenderSeq) return;
    tbody.innerHTML = html;
}
function openCandidateModal(action = 'add', id = '') {
    const modal = document.getElementById('candidateModal');
    const titleEl = document.getElementById('candidateModalTitle');
    const form = document.getElementById('candidateForm');
    const idInput = document.getElementById('candidateIdInput');
    const noUrutInput = document.getElementById('candidateNoUrutInput');
    const nameInput = document.getElementById('candidateNameInput');
    const kelasInput = document.getElementById('candidateKelasInput');
    const posisiInput = document.getElementById('candidatePosisiInput');
    const visiInput = document.getElementById('candidateVisiInput');
    const misiInput = document.getElementById('candidateMisiInput');
    const photoPreview = document.getElementById('candidatePhotoPreview');
    const activePhotoText = document.getElementById('activeCandidatePhotoText');
    const statusEl = document.getElementById('candidatePhotoUploadStatus');
    if (!modal || !form) return;
    const modalSeq = ++candidateModalSeq;
    form.reset();
    window.tempCandidatePhoto = null;
    document.getElementById('candidatePhotoFileInput').value = '';
    if (photoPreview) photoPreview.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    if (statusEl) {
        statusEl.textContent = "Klik untuk mengunggah foto baru (otomatis ≤100 KB)...";
        statusEl.className = "font-medium text-slate-300";
    }
    document.getElementById('candidateActionType').value = action;

    const fillCandidateForm = (record) => {
        if (!record) return;
        noUrutInput.value = record.nomor_urut || "";
        nameInput.value = record.nama || "";
        kelasInput.value = record.kelas || "";
        posisiInput.value = record.posisi || "";
        if (visiInput) visiInput.value = record.visi || "";
        if (misiInput) misiInput.value = record.misi || "";
        if (activePhotoText) activePhotoText.textContent = record.foto || "ID_Default";
        if (record.foto) {
            resolveImage(record.foto).then(resolved => {
                if (modalSeq !== candidateModalSeq) return;
                if (idInput.value !== id) return;
                if (resolved && photoPreview) photoPreview.src = resolved;
            });
        }
    };

    if (action === 'add') {
        titleEl.textContent = "Tambah Kandidat Baru";
        idInput.value = "";
        if (visiInput) visiInput.value = "";
        if (misiInput) misiInput.value = "";
        if (activePhotoText) activePhotoText.textContent = "ID_Default";
    } else {
        titleEl.textContent = "Edit Data Kandidat";
        idInput.value = id;
        const cached = allCandidateRecords.find(c => c.id === id);
        if (cached) fillCandidateForm(cached);
        db.from('kandidat').select(DB_SELECT.KANDIDAT_LIST).eq('id', id).maybeSingle().then(({ data: record, error }) => {
            if (modalSeq !== candidateModalSeq) return;
            if (idInput.value !== id) return;
            if (error || !record) {
                if (!cached) showAlert('Gagal memuat data kandidat. Data mungkin sudah dihapus.', false);
                return;
            }
            fillCandidateForm(record);
        });
    }
    modal.classList.add('active');
}
function closeCandidateModal() {
    candidateModalSeq++;
    candidatePhotoBusy = false;
    window.tempCandidatePhoto = null;
    const modal = document.getElementById('candidateModal');
    if (modal) modal.classList.remove('active');
}
function processCandidatePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const statusEl = document.getElementById('candidatePhotoUploadStatus');
    if (statusEl) {
        statusEl.textContent = "Mengompres foto (maks. 100 KB)...";
        statusEl.className = "font-semibold text-yellow-500";
    }
    const photoPreview = document.getElementById('candidatePhotoPreview');
    const activePhotoText = document.getElementById('activeCandidatePhotoText');
    const form = document.getElementById('candidateForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    const compressId = ++candidateModalSeq;
    candidatePhotoBusy = true;
    if (submitBtn) submitBtn.disabled = true;

    const maxDim = IMAGE_COMPRESS_PHOTO_MAX_DIM;
    const resetStatus = () => {
        if (compressId !== candidateModalSeq) return;
        candidatePhotoBusy = false;
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) {
            statusEl.textContent = "Klik untuk mengunggah foto baru (otomatis ≤100 KB)...";
            statusEl.className = "font-medium text-slate-300";
        }
    };
    compressImageToLimit(file, maxDim, IMAGE_COMPRESS_MAX_KB, function (base64Data, shortId, sizeInKb) {
        if (compressId !== candidateModalSeq) return;
        candidatePhotoBusy = false;
        if (submitBtn) submitBtn.disabled = false;
        const uniqueName = `kandidat_${shortId}.jpg`;
        window.tempCandidatePhoto = { id: uniqueName, data: base64Data };
        if (photoPreview) photoPreview.src = base64Data;
        if (activePhotoText) activePhotoText.textContent = uniqueName;
        if (statusEl) {
            statusEl.textContent = `Foto siap: ${uniqueName} (${sizeInKb} KB / maks. 100). Klik Simpan!`;
            statusEl.className = "font-bold text-emerald-500";
        }
        showAlert(`Foto kandidat dikompres ke ${sizeInKb} KB (maks. 100 KB)!`, true);
    }, resetStatus);
}
async function saveCandidate(e) {
    e.preventDefault();
    if (savingCandidate) return;
    if (candidatePhotoBusy) {
        showAlert('Tunggu hingga foto selesai diproses sebelum menyimpan.', false);
        return;
    }
    const action = document.getElementById('candidateActionType').value;
    const id = document.getElementById('candidateIdInput').value;
    const noUrut = document.getElementById('candidateNoUrutInput').value.trim();
    const name = document.getElementById('candidateNameInput').value.trim();
    const kelas = document.getElementById('candidateKelasInput').value.trim();
    const posisi = document.getElementById('candidatePosisiInput').value;
    const visi = document.getElementById('candidateVisiInput') ? document.getElementById('candidateVisiInput').value.trim() : '';
    const misi = document.getElementById('candidateMisiInput') ? document.getElementById('candidateMisiInput').value.trim() : '';
    if (!noUrut || !name || !kelas || !posisi) {
        showAlert('No. urut, nama, kelas, dan posisi wajib diisi.', false);
        return;
    }
    savingCandidate = true;
    const submitBtn = e.target && e.target.querySelector
        ? e.target.querySelector('button[type="submit"]')
        : null;
    if (submitBtn) submitBtn.disabled = true;
    try {
        let photoId = "";
        let oldPhotoId = "";
        if (action === 'edit') {
            const record = allCandidateRecords.find(c => c.id === id);
            if (record && record.foto) {
                photoId = record.foto;
                oldPhotoId = record.foto;
            }
        }
        if (window.tempCandidatePhoto) {
            photoId = await saveImage('photos', window.tempCandidatePhoto.id, window.tempCandidatePhoto.data);
        }

        const docId = action === 'add'
            ? (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2))
            : id;
        const saveData = {
            id: docId,
            nomor_urut: parseInt(noUrut) || 1,
            nama: name,
            kelas: kelas,
            posisi: posisi,
            visi: visi,
            misi: misi,
            foto: photoId,
            updated_at: new Date().toISOString()
        };
        const { error: saveError } = await db.from('kandidat').upsert(saveData);
        if (saveError) throw saveError;
        if (window.tempCandidatePhoto && action === 'edit' && oldPhotoId && oldPhotoId !== photoId) {
            try {
                await deleteStoredImage(oldPhotoId);
            } catch (e) {
                console.warn("Gagal menghapus foto lama:", e);
            }
        }
        showAlert("Data kandidat berhasil disimpan!", true);
        const statusEl = document.getElementById('candidatePhotoUploadStatus');
        if (statusEl) {
            statusEl.textContent = "Klik untuk mengunggah foto baru (otomatis ≤100 KB)...";
            statusEl.className = "font-medium text-slate-300";
        }
        window.tempCandidatePhoto = null;
        closeCandidateModal();
        clearCachedJson('candidates_data');
        loadCandidateData(true);
    } catch (err) {
        console.error("Error saving candidate:", err);
        showAlert(`Gagal menyimpan kandidat: ${err.message}`, false);
    } finally {
        savingCandidate = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}

function deleteCandidate(id, name) {
    showModal(
        "Hapus Kandidat",
        `Apakah Anda yakin ingin menghapus kandidat <strong>${escapeHtml(name)}</strong>? Pemilih yang sudah memilih kandidat ini akan diizinkan memilih ulang.`,
        true,
        "Hapus",
        async () => {
            try {
                const { data: candData, error: candErr } = await db.from('kandidat').select('foto').eq('id', id).maybeSingle();
                if (candErr) throw candErr;
                const photoId = candData && candData.foto ? candData.foto : '';

                const { data: delRes, error: delErr } = await db.rpc('delete_candidate_and_reconcile', {
                    p_session_token: getAdminSessionToken(),
                    p_kandidat_id: id
                });
                if (delErr) throw delErr;
                if (delRes && delRes.success === false) {
                    throw new Error(delRes.error || 'Gagal menghapus kandidat');
                }

                if (photoId) {
                    try { await deleteStoredImage(photoId); } catch (e) {
                        console.warn('Gagal menghapus foto kandidat:', e);
                    }
                }

                showAlert(`Kandidat ${name} berhasil dihapus!`, true);
                clearCachedJson('candidates_data');
                ['siswa', 'guru', 'staf'].forEach(t => clearCachedJson('voters_' + t));
                loadCandidateData(true);
            } catch (err) {
                console.error("Error deleting candidate:", err);
                showAlert(`Gagal menghapus kandidat: ${err.message}`, false);
            }
        }
    );
}

function deleteAllCandidates() {
    if (bulkDestructiveBusy) {
        showAlert('Operasi massal masih berjalan. Tunggu hingga selesai.', false);
        return;
    }
    showModal(
        "Hapus Semua Kandidat",
        `Apakah Anda yakin ingin menghapus <strong>semua kandidat beserta fotonya</strong>? Status pemilih yang sudah memilih juga akan direset. Tindakan ini tidak dapat dibatalkan!`,
        true,
        "Hapus Semua",
        async () => {
            if (bulkDestructiveBusy) return;
            bulkDestructiveBusy = true;
            try {
                const { data: allCands, error: listErr } = await db.from('kandidat').select('id, foto');
                if (listErr) throw listErr;
                if (!allCands || allCands.length === 0) {
                    showAlert('Tidak ada data kandidat untuk dihapus.', false);
                    return;
                }

                const photoIds = allCands.map(c => c.foto).filter(Boolean);

                const { data: delRes, error: delErr } = await db.rpc('delete_all_candidates_and_reconcile', {
                    p_session_token: getAdminSessionToken()
                });
                if (delErr) throw delErr;
                if (delRes && delRes.success === false) {
                    throw new Error(delRes.error || 'Gagal menghapus semua kandidat');
                }

                for (const pid of photoIds) {
                    try { await deleteStoredImage(pid); } catch (e) {
                        console.warn('Gagal menghapus foto kandidat:', e);
                    }
                }

                showAlert(`${allCands.length} kandidat dan foto terkait berhasil dihapus!`, true);
                clearCachedJson('candidates_data');
                ['siswa', 'guru', 'staf'].forEach(t => clearCachedJson('voters_' + t));
                loadCandidateData(true);
            } catch (err) {
                console.error("Error deleting all candidates:", err);
                showAlert(`Gagal menghapus semua kandidat: ${err.message}`, false);
            } finally {
                bulkDestructiveBusy = false;
            }
        }
    );
}

async function exportPDF() {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
        showAlert('Library PDF belum termuat. Muat ulang halaman lalu coba lagi.', false);
        return;
    }
    try {
        await updateDashboard();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(`Laporan Hasil Pemilihan ${getConfiguredSchoolName()}`, 14, 22);
        doc.setFontSize(14);
        doc.text("Data Partisipasi", 14, 35);
        doc.autoTable({
            html: '#tabel-partisipasi',
            startY: 40,
            theme: 'grid',
            styles: {
                overflow: 'linebreak',
                cellPadding: 2,
                fontSize: 9,
            halign: 'center'
        },
        headStyles: {
            fillColor: [44, 62, 80]
        },
        didParseCell: function (data) {
            if (data.row.section === 'body' && data.row.index === data.table.body.length - 1) {
                data.cell.styles.fillColor = [52, 152, 219];
                data.cell.styles.textColor = [255, 255, 255];
                if (data.column.index === 0) {
                    data.cell.styles.fillColor = [41, 128, 185];
                }
            }
        }
    });
    let finalY_1 = doc.autoTable.previous.finalY;
    doc.setFontSize(14);
    doc.text("Kandidat Terpilih", 14, finalY_1 + 15);
    doc.autoTable({
        html: '#tabel-pemenang',
        startY: finalY_1 + 20,
        theme: 'grid',
        styles: {
            overflow: 'linebreak',
            cellPadding: 2,
            fontSize: 9,
            halign: 'center'
        },
        columnStyles: {
            1: { halign: 'left' },
            2: { halign: 'left' }
        },
        headStyles: {
            fillColor: [44, 62, 80]
        }
    });
    let finalY_2 = doc.autoTable.previous.finalY;
    doc.setFontSize(14);
    doc.text("Hasil Pemilihan", 14, finalY_2 + 15);
    doc.autoTable({
        html: '#tabel-rinci',
        startY: finalY_2 + 20,
        theme: 'grid',
        styles: {
            overflow: 'linebreak',
            cellPadding: 2,
            fontSize: 9,
            halign: 'center'
        },
        columnStyles: {
            1: { halign: 'left' },
            2: { halign: 'left' }
        },
        headStyles: {
            fillColor: [44, 62, 80]
        }
    });
        doc.save('Laporan-Hasil-Pemilihan-SMANDA.pdf');
    } catch (err) {
        console.error('Export PDF gagal:', err);
        showAlert('Gagal membuat laporan PDF: ' + (err.message || 'error tidak dikenal'), false);
    }
}

async function downloadWordTemplateKandidat() {
    let blob = null;
    if (typeof KANDIDAT_WORD_TEMPLATE_BASE64 === 'string' && KANDIDAT_WORD_TEMPLATE_BASE64) {
        blob = base64ToBlob(
            'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' +
            KANDIDAT_WORD_TEMPLATE_BASE64
        );
    }
    if (!blob) {
        showAlert('File template Word belum tersedia. Impor kandidat manual atau hubungi panitia.', false);
        return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'Template Data Kandidat.docx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);

    showModal(
        "Informasi Penting",
        "Template Word berhasil diunduh (<b>Template Data Kandidat.docx</b>).<br><br>" +
        "1. Isi/edit data pada tabel (jangan ubah baris header).<br>" +
        "2. Sisipkan foto lewat <b>Insert → Pictures</b> di kolom Foto.<br>" +
        "3. Simpan tetap sebagai <b>.docx</b>, lalu gunakan tombol Import Word.",
        false,
        "Saya Mengerti",
        null
    );
}

async function handleWordKandidatImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (importingWord) {
        showAlert('Impor Word masih berjalan. Tunggu hingga selesai.', false);
        event.target.value = '';
        return;
    }

    if (file.name.toLowerCase().endsWith('.doc')) {
        showAlert("GAGAL: File masih berformat .doc lama. Gunakan template .docx (Template Data Kandidat.docx).", false);
        event.target.value = '';
        return;
    }

    importingWord = true;
    showAlert("Menganalisis file Word (.docx) dan mengekstrak gambar...", true);
    const reader = new FileReader();

    reader.onload = async function (e) {
        try {
            const zip = await JSZip.loadAsync(e.target.result);

            let relsXml = "";
            if (zip.file("word/_rels/document.xml.rels")) {
                relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
            }
            const parser = new DOMParser();
            const relsDoc = parser.parseFromString(relsXml || '<Relationships/>', "application/xml");
            const relMap = {};

            const qLocal = (root, localName) => {
                const out = [];
                const walk = (node) => {
                    if (!node) return;
                    if (node.nodeType === 1 && node.localName === localName) out.push(node);
                    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
                };
                walk(root);
                return out;
            };

            qLocal(relsDoc, 'Relationship').forEach((rel) => {
                const id = rel.getAttribute('Id');
                const target = rel.getAttribute('Target');
                if (id && target) relMap[id] = target;
            });

            const docXml = await zip.file("word/document.xml").async("string");
            const xmlDoc = parser.parseFromString(docXml, "application/xml");

            const tables = qLocal(xmlDoc, 'tbl');
            if (tables.length === 0) {
                showAlert("Tidak ada tabel data ditemukan di dalam file Word!", false);
                return;
            }

            const pickCandidateTable = (allTables) => {
                for (const tbl of allTables) {
                    const headerRow = qLocal(tbl, 'tr')[0];
                    if (!headerRow) continue;
                    const headerText = qLocal(headerRow, 't').map(t => (t.textContent || '').trim().toLowerCase()).join(' ');
                    if (headerText.includes('nama') && (headerText.includes('posisi') || headerText.includes('urut'))) {
                        return tbl;
                    }
                }
                return allTables[0];
            };

            const table = pickCandidateTable(tables);
            const rows = qLocal(table, 'tr');
            const parsedCandidates = [];
            const headerSkip = /^(posisi\s*\/\s*jabatan|nama\s*kandidat|no\.?\s*urut)$/i;

            for (let i = 1; i < rows.length; i++) {
                const cells = qLocal(rows[i], 'tc');
                if (cells.length < 6) continue;

                const getText = (cell) => {
                    let text = "";
                    qLocal(cell, 'p').forEach(p => {
                        let pText = "";
                        qLocal(p, 't').forEach(t => { pText += t.textContent; });
                        if (pText) text += pText.trim() + "\n";
                    });
                    return text.trim();
                };

                const noUrut = getText(cells[0]);
                const posisi = getText(cells[1]);
                const nama = getText(cells[2]);
                const kelas = getText(cells[3]);
                const visi = getText(cells[4]);
                const misi = getText(cells[5]);

                let base64Image = null;
                if (cells[6]) {
                    const blips = qLocal(cells[6], 'blip');
                    if (blips.length > 0) {
                        const blip = blips[0];
                        const embedId = blip.getAttribute('r:embed')
                            || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
                            || blip.getAttribute('embed');
                        if (embedId && relMap[embedId]) {
                            let targetPath = String(relMap[embedId]).replace(/\\/g, '/');
                            if (targetPath.startsWith('/word/')) targetPath = targetPath.substring(6);
                            else if (targetPath.startsWith('../')) targetPath = targetPath.replace(/^(\.\.\/)+/, '');
                            if (!targetPath.startsWith('word/') && !targetPath.startsWith('media/')) {
                                targetPath = 'media/' + targetPath.replace(/^\/+/, '');
                            }
                            const imgPath = targetPath.startsWith('media/') ? ('word/' + targetPath) : targetPath;

                            if (zip.file(imgPath)) {
                                const imgData = await zip.file(imgPath).async("base64");
                                const ext = imgPath.split('.').pop().toLowerCase();
                                let mime = 'image/jpeg';
                                if (ext === 'png') mime = 'image/png';
                                else if (ext === 'gif') mime = 'image/gif';
                                else if (ext === 'webp') mime = 'image/webp';
                                else if (ext === 'bmp') mime = 'image/bmp';
                                else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
                                base64Image = `data:${mime};base64,${imgData}`;
                            }
                        }
                    }
                }

                if (nama && posisi && !headerSkip.test(posisi) && !headerSkip.test(nama)) {
                    parsedCandidates.push({
                        nomor_urut: parseInt(noUrut, 10) || 1,
                        posisi: posisi,
                        nama: nama,
                        kelas: kelas,
                        visi: visi,
                        misi: misi,
                        tempImageData: base64Image
                    });
                }
            }

            if (parsedCandidates.length === 0) {
                showAlert("Tabel kosong atau struktur data kandidat tidak valid! Pastikan mengikuti format Template Data Kandidat.docx.", false);
                return;
            }

            showAlert(`Mengompres foto (maks. 100 KB) & menyimpan ${parsedCandidates.length} kandidat...`, true);

            const { data: existingCands, error: existingErr } = await db.from('kandidat').select('id,posisi,nomor_urut,foto');
            if (existingErr) throw existingErr;
            const existingMap = new Map(
                (existingCands || []).map(c => [`${String(c.posisi || '').trim()}||${Number(c.nomor_urut) || 0}`, c])
            );

            let okCount = 0;
            let failCount = 0;
            for (const cand of parsedCandidates) {
                try {
                    let finalPhotoId = "";
                    const matchKey = `${String(cand.posisi || '').trim()}||${Number(cand.nomor_urut) || 0}`;
                    const prev = existingMap.get(matchKey) || null;

                    if (cand.tempImageData) {
                        try {
                            const compressed = await compressDataUrlToLimit(
                                cand.tempImageData,
                                IMAGE_COMPRESS_PHOTO_MAX_DIM,
                                IMAGE_COMPRESS_MAX_KB
                            );
                            const finalPhotoName = `kandidat_${compressed.shortId}.jpg`;
                            AppStorage.set('img_' + finalPhotoName, compressed.data);
                            finalPhotoId = await saveImage('photos', finalPhotoName, compressed.data);
                        } catch (imgErr) {
                            console.warn('Gagal kompres/simpan foto kandidat, memakai foto lama jika ada:', imgErr);
                            finalPhotoId = (prev && prev.foto) ? prev.foto : "";
                        }
                    } else if (prev && prev.foto) {
                        finalPhotoId = prev.foto;
                    }

                    const docId = prev?.id || (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substr(2)));
                    const { error: insErr } = await db.from('kandidat').upsert({
                        id: docId,
                        nomor_urut: cand.nomor_urut,
                        nama: cand.nama,
                        kelas: cand.kelas,
                        posisi: cand.posisi,
                        visi: cand.visi,
                        misi: cand.misi,
                        foto: finalPhotoId,
                        updated_at: new Date().toISOString()
                    });
                    if (insErr) throw insErr;
                    if (cand.tempImageData && prev && prev.foto && prev.foto !== finalPhotoId) {
                        try { await deleteStoredImage(prev.foto); } catch (e) {}
                    }
                    existingMap.set(matchKey, { id: docId, posisi: cand.posisi, nomor_urut: cand.nomor_urut, foto: finalPhotoId });
                    okCount++;
                } catch (rowErr) {
                    console.error('Gagal impor baris kandidat:', cand?.nama, rowErr);
                    failCount++;
                }
            }

            clearCachedJson('candidates_data');
            loadCandidateData(true);
            if (failCount === 0) {
                showAlert(`Berhasil mengimpor ${okCount} kandidat dari file Word!`, true);
            } else if (okCount === 0) {
                showAlert(`Gagal mengimpor kandidat (${failCount} baris gagal).`, false);
            } else {
                showAlert(`Impor selesai: ${okCount} berhasil, ${failCount} gagal.`, false);
            }

        } catch (err) {
            console.error("Word Import Error:", err);
            clearCachedJson('candidates_data');
            loadCandidateData(true);
            showAlert("Gagal memproses file Word. Pastikan Anda mengunggah file berekstensi .docx yang valid.", false);
        } finally {
            importingWord = false;
            event.target.value = '';
        }
    };

    reader.onerror = function () {
        importingWord = false;
        showAlert('Gagal membaca file Word.', false);
        event.target.value = '';
    };

    reader.readAsArrayBuffer(file);
}
