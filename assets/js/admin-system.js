'use strict';

const DEFAULT_JADWAL_PENGATURAN = {
    id: 'jadwal_pemilihan',
    mode: 'manual',
    active: false,
    mulai: null,
    selesai: null
};

function formatWaktu(datetimeStr) {
    if (!datetimeStr) return '';
    const d = new Date(datetimeStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDatetimeLocalValue(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const naive = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
        if (naive && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value.trim())) {
            return naive[1];
        }
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(localValue) {
    if (!localValue) return null;
    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

function applyJadwalFormDefaults(data) {
    const manualToggle = document.getElementById('manualToggleStatus');
    const manualLabel = document.getElementById('manualToggleLabel');
    const mulaiEl = document.getElementById('jadwalMulai');
    const selesaiEl = document.getElementById('jadwalSelesai');
    const isManualOpen = !!(data && (data.active === true || data.active === 1) && data.mode === 'manual');

    if (manualToggle) manualToggle.checked = isManualOpen;
    if (manualLabel) {
        manualLabel.textContent = isManualOpen ? 'BUKA' : 'TUTUP';
        manualLabel.className = isManualOpen
            ? 'ml-3 text-xs font-bold text-emerald-600'
            : 'ml-3 text-xs font-bold text-rose-600';
    }
    if (mulaiEl) mulaiEl.value = toDatetimeLocalValue(data && data.mulai);
    if (selesaiEl) selesaiEl.value = toDatetimeLocalValue(data && data.selesai);
}

function renderJadwalStatus(data) {
    const infoDiv = document.getElementById('infoJadwalAktif');
    if (!infoDiv) return;

    if (!data) {
        applyJadwalFormDefaults(DEFAULT_JADWAL_PENGATURAN);
        infoDiv.innerHTML = '<i class="fas fa-info-circle text-slate-500 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left">Status: <b class="text-slate-600">Mode manual nonaktif (Akses Ditutup)</b></span>';
        return;
    }

    if (data.mode === 'manual') {

        applyJadwalFormDefaults({
            mode: 'manual',
            active: data.active,
            mulai: null,
            selesai: null
        });
        const isManualOpen = data.active === true || data.active === 1;
        if (isManualOpen) {
            infoDiv.innerHTML = '<i class="fas fa-exclamation-circle text-emerald-600 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left text-emerald-700">Status: <b>Manual Aktif</b> (Akses Pemilihan Terbuka) — jadwal otomatis direset ke default</span>';
        } else {
            infoDiv.innerHTML = '<i class="fas fa-info-circle text-slate-500 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left">Status: <b class="text-slate-600">Mode manual nonaktif (Akses Ditutup)</b></span>';
        }
        return;
    }

    if (data.mode === 'auto') {

        applyJadwalFormDefaults({
            mode: 'auto',
            active: false,
            mulai: data.mulai,
            selesai: data.selesai
        });

        const now = new Date();
        const end = new Date(data.selesai);
        const start = new Date(data.mulai);

        if (!data.mulai || !data.selesai || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            infoDiv.innerHTML = '<i class="fas fa-exclamation-triangle text-amber-600 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left text-amber-700">Status: <b>Jadwal otomatis tidak valid</b> — isi waktu mulai/selesai lalu simpan</span>';
        } else if (now > end) {
            infoDiv.innerHTML = '<i class="fas fa-info-circle text-slate-500 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left">Status: <b class="text-slate-600">Jadwal otomatis telah berakhir (Akses Ditutup)</b> — kontrol manual TUTUP</span>';
        } else if (now >= start && now <= end) {
            infoDiv.innerHTML = `<i class="fas fa-clock text-emerald-600 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left text-emerald-700">Status: <b>Sedang Aktif Otomatis</b> hingga ${formatWaktu(data.selesai)} — kontrol manual TUTUP</span>`;
        } else {
            infoDiv.innerHTML = `<i class="fas fa-calendar-check text-sky-600 text-base sm:text-lg flex-shrink-0 mt-0.5 sm:mt-0"></i> <span class="leading-snug text-left text-sky-700">Status: <b>Akan Aktif Otomatis</b> pada ${formatWaktu(data.mulai)} — kontrol manual TUTUP</span>`;
        }
    }
}

async function toggleJadwalManual(isActive) {
    if (savingJadwal) {
        const manualToggle = document.getElementById('manualToggleStatus');
        if (manualToggle) manualToggle.checked = !isActive;
        return;
    }
    const manualToggle = document.getElementById('manualToggleStatus');

    savingJadwal = true;
    try {

        const payload = {
            id: 'jadwal_pemilihan',
            mode: 'manual',
            active: !!isActive,
            mulai: null,
            selesai: null,
            updated_at: new Date().toISOString()
        };

        const { error } = await db.from('pengaturan').upsert(payload);
        if (error) throw error;
        renderJadwalStatus(payload);
        if (isActive) {
            showAlert('Akses pemilihan dibuka (manual). Jadwal otomatis dikembalikan ke default.', true);
        } else {
            showAlert('Akses pemilihan ditutup (manual). Jadwal otomatis tetap di nilai default.', true);
        }
    } catch (err) {
        console.error(err);
        if (manualToggle) manualToggle.checked = !isActive;
        showAlert('Gagal mengubah jadwal manual', false);
    } finally {
        savingJadwal = false;
    }
}
async function simpanJadwalOtomatis() {
    if (savingJadwal) return;
    const mulaiLocal = document.getElementById('jadwalMulai').value;
    const selesaiLocal = document.getElementById('jadwalSelesai').value;
    if (!mulaiLocal || !selesaiLocal) {
        showAlert('Silakan isi waktu mulai dan selesai!', false);
        return;
    }
    savingJadwal = true;
    try {
        const mulai = fromDatetimeLocalValue(mulaiLocal);
        const selesai = fromDatetimeLocalValue(selesaiLocal);
        if (!mulai || !selesai) {
            showAlert('Format tanggal/waktu tidak valid!', false);
            return;
        }
        const now = new Date();
        const start = new Date(mulai);
        const end = new Date(selesai);
        if (end <= start) {
            showAlert('Waktu selesai harus setelah waktu mulai!', false);
            return;
        }
        const isActive = now >= start && now <= end;

        const payload = {
            id: 'jadwal_pemilihan',
            mode: 'auto',
            active: isActive,
            mulai,
            selesai,
            updated_at: new Date().toISOString()
        };
        const { error } = await db.from('pengaturan').upsert(payload);
        if (error) throw error;
        renderJadwalStatus(payload);
        if (isActive) {
            showAlert('Jadwal otomatis aktif. Kontrol manual ditutup.', true);
        } else if (now < start) {
            showAlert('Jadwal otomatis disimpan. Kontrol manual ditutup; akses akan aktif pada waktu mulai.', true);
        } else {
            showAlert('Jadwal otomatis disimpan (sudah berakhir). Kontrol manual ditutup.', true);
        }
    } catch (err) {
        console.error(err);
        const msg = String(err?.message || '');
        if (/operator does not exist|timestamp with time zone/i.test(msg)) {
            showAlert('Gagal menyimpan jadwal: format waktu di database perlu diperbaiki. Jalankan patch SQL jadwal.', false);
        } else {
            showAlert('Gagal menyimpan jadwal otomatis', false);
        }
    } finally {
        savingJadwal = false;
    }
}

async function ensureDefaultJadwalPengaturan() {
    const payload = {
        ...DEFAULT_JADWAL_PENGATURAN,
        updated_at: new Date().toISOString()
    };
    const { error } = await db.from('pengaturan').upsert(payload);
    if (error) throw error;
    return payload;
}

function loadJadwalPengaturan() {
    const syncAutoActiveFlag = async (data) => {
        if (!data || data.mode !== 'auto') return data;
        if (!data.mulai || !data.selesai) return data;
        const now = new Date();
        const end = new Date(data.selesai);
        const start = new Date(data.mulai);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return data;
        if (now > end) {
            if (data.active) {
                await db.from('pengaturan').update({ active: false, updated_at: new Date().toISOString() }).eq('id', 'jadwal_pemilihan');
                data.active = false;
            }
            return data;
        }
        const shouldBeActive = now >= start && now <= end;
        if (Boolean(data.active) !== shouldBeActive) {
            await db.from('pengaturan').update({ active: shouldBeActive, updated_at: new Date().toISOString() }).eq('id', 'jadwal_pemilihan');
            data.active = shouldBeActive;
        }
        return data;
    };

    const fetchJadwal = async (allowWrite = false) => {
        if (activeAdminView !== 'jadwal') return;
        try {
            const { data, error } = await db.from('pengaturan').select(DB_SELECT.JADWAL).eq('id', 'jadwal_pemilihan').maybeSingle();
            if (error) throw error;
            if (!data) {
                if (allowWrite) {
                    const seeded = await ensureDefaultJadwalPengaturan();
                    renderJadwalStatus(seeded);
                } else {
                    renderJadwalStatus(DEFAULT_JADWAL_PENGATURAN);
                }
                return;
            }
            const next = allowWrite ? await syncAutoActiveFlag(data) : data;
            renderJadwalStatus(next);
        } catch (err) {
            console.error(err);
            renderJadwalStatus(DEFAULT_JADWAL_PENGATURAN);
        }
    };

    fetchJadwal(true);
}



function toggleProfileDropdown() {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

window.addEventListener('click', function (e) {
    const container = document.getElementById('headerProfileContainer');
    if (container && !container.contains(e.target)) {
        const dropdown = document.getElementById('profileDropdown');
        if (dropdown && !dropdown.classList.contains('hidden')) {
            dropdown.classList.add('hidden');
        }
    }
});

let adminSearchKeyword = '';
let adminRecords = [];

async function updateAdminCredentials(currentUsername, newUsername, newPassword) {
    const session = getAdminSession() || {};
    const pCurrent = currentUsername || session.user || '';
    const token = getAdminSessionToken();
    if (!token) throw new Error('Sesi admin tidak valid. Silakan login ulang.');

    const { data, error } = await db.rpc('update_admin_profile', {
        p_session_token: token,
        p_current_username: pCurrent,
        p_new_username: newUsername,
        p_new_password: newPassword
    });
    if (error) throw error;
    if (!data || !data.success) {
        throw new Error(data?.error || 'Gagal memperbarui profil admin');
    }

    if (session.user === pCurrent) {
        setAdminSession(data.username, token);
        const headerNameEl = document.getElementById('headerAdminName');
        if (headerNameEl) headerNameEl.textContent = data.username;
    }

    return data.username;
}

async function loadAdminData(forceRefresh = false) {
    const tbody = document.getElementById('adminTableBody');
    if (tbody && forceRefresh) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-10 text-gray-400">
                    <i class="fas fa-spinner animate-spin text-2xl mb-2 block"></i>
                    Memuat data admin...
                </td>
            </tr>`;
    }

    try {
        const token = getAdminSessionToken();
        if (!token) throw new Error('Sesi admin tidak valid');
        const { data, error } = await db.rpc('get_all_admins', { p_session_token: token });
        if (!error && data && data.success) {
            adminRecords = Array.isArray(data.admins) ? data.admins : [];
        } else {
            adminRecords = [];
            const detail = error?.message || data?.error || '';
            const msg = (detail.includes('get_all_admins') || (error && String(error.message || '').includes('Could not find')))
                ? 'RPC get_all_admins belum di-update. Jalankan Database/schema.sql di Supabase SQL Editor.'
                : (detail ? `Gagal memuat data admin: ${detail}` : 'Gagal memuat data admin. Periksa koneksi atau jalankan schema.sql.');
            showAlert(msg, false);
        }
    } catch (err) {
        console.error('Error loading admin data:', err);
        adminRecords = [];
        const msg = (err.message || '').includes('get_all_admins')
            ? 'RPC get_all_admins belum di-update. Jalankan Database/schema.sql di Supabase SQL Editor.'
            : 'Gagal memuat data admin. Periksa koneksi atau jalankan schema.sql.';
        showAlert(msg, false);
    }

    renderAdminTable();
}

function searchAdmin(val) {
    adminSearchKeyword = val;
    renderAdminTable();
}

function sortAdminRecords(records) {
    return [...records].sort((a, b) =>
        String(a.username || '').localeCompare(String(b.username || ''), 'id', { numeric: true, sensitivity: 'base' })
    );
}

function renderAdminTable() {
    const tbody = document.getElementById('adminTableBody');
    const infoEl = document.getElementById('adminTableInfo');
    if (!tbody) return;

    const filtered = sortAdminRecords(
        adminRecords.filter(record =>
            !adminSearchKeyword ||
            (record.username || '').toLowerCase().includes(adminSearchKeyword.toLowerCase())
        )
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-10 text-gray-500 text-center">
                    Tidak ada data admin ditemukan.
                </td>
            </tr>`;
        if (infoEl) infoEl.textContent = 'Menampilkan 0-0 dari 0 data';
        return;
    }

    let html = '';
    const session = getAdminSession() || {};
    const currentUser = session.user || '';
    filtered.forEach((record, index) => {
        const username = record.username || '';
        const adminPassword = record.password || '-';
        const isHashed = /^\$2[aby]?\$/.test(String(adminPassword));
        const isSelf = username === currentUser;
        const deleteBtn = isSelf
            ? ''
            : `<button type="button" data-table-action="delete-admin" data-record-username="${escapeHtmlAttr(username)}" class="text-rose-500 hover:text-rose-700 font-semibold transition-colors">Hapus</button>`;
        const passwordCell = isHashed
            ? `<span class="text-amber-600 text-[11px]" title="Password lama masih terenkripsi. Edit admin untuk set password baru.">Perlu di-set ulang</span>`
            : `<span class="admin-password-display">${VOTER_PASSWORD_MASK}</span>
                <button type="button" data-table-action="toggle-password" data-password="${escapeHtmlAttr(adminPassword)}" class="ml-1.5 text-gray-400 hover:text-sky-600 focus:outline-none" title="Tampilkan/Sembunyikan Sandi">
                    <i class="fas fa-eye text-xs"></i>
                </button>`;
        html += `
        <tr class="hover:bg-slate-50 border-b border-gray-100 transition-colors">
            <td class="py-3 px-3 border border-gray-200 text-center font-medium text-gray-500">${index + 1}</td>
            <td class="py-3 px-3 border border-gray-200 text-center font-mono font-semibold">${escapeHtml(username)}</td>
            <td class="py-3 px-3 border border-gray-200 text-center font-mono relative">
                ${passwordCell}
            </td>
            <td class="py-3 px-3 border border-gray-200 text-center">
                <button type="button" data-table-action="edit-admin" data-record-username="${escapeHtmlAttr(username)}" class="text-sky-600 hover:text-sky-800 font-semibold mr-3 transition-colors">Edit</button>
                ${deleteBtn}
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;

    if (infoEl) infoEl.textContent = `Menampilkan 1-${filtered.length} dari ${filtered.length} data`;
}

function openAdminModal(action = 'add', username = '') {
    const modal = document.getElementById('adminProfileModal');
    if (!modal) return;

    const actionInput = document.getElementById('adminActionType');
    const editUsernameInput = document.getElementById('adminEditUsername');
    const titleEl = document.getElementById('adminModalTitle');
    const usernameLabel = document.getElementById('adminUsernameLabel');
    const passwordLabel = document.getElementById('adminPasswordLabel');
    const usernameInput = document.getElementById('adminUsernameInput');
    const passwordInput = document.getElementById('adminPasswordInput');
    const confirmInput = document.getElementById('adminPasswordConfirmInput');

    const isEdit = action === 'edit';
    if (actionInput) actionInput.value = isEdit ? 'edit' : 'add';
    if (editUsernameInput) editUsernameInput.value = isEdit ? username : '';

    if (titleEl) {
        titleEl.innerHTML = isEdit
            ? '<i class="fas fa-user-shield mr-2 text-sky-400"></i>Ubah Admin'
            : '<i class="fas fa-user-shield mr-2 text-sky-400"></i>Tambah Admin';
    }
    if (usernameLabel) usernameLabel.textContent = isEdit ? 'Username Baru' : 'Username';
    if (passwordLabel) passwordLabel.textContent = isEdit ? 'Password Baru' : 'Password';

    if (usernameInput) usernameInput.value = isEdit ? username : '';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';

    modal.classList.add('active');
    modal.classList.remove('hidden');
}

function openAdminProfileModal() {
    const session = getAdminSession() || {};
    const modal = document.getElementById('adminProfileModal');
    if (!modal) return;

    const actionInput = document.getElementById('adminActionType');
    const editUsernameInput = document.getElementById('adminEditUsername');
    const titleEl = document.getElementById('adminModalTitle');
    const usernameLabel = document.getElementById('adminUsernameLabel');
    const passwordLabel = document.getElementById('adminPasswordLabel');
    const usernameInput = document.getElementById('adminUsernameInput');
    const passwordInput = document.getElementById('adminPasswordInput');
    const confirmInput = document.getElementById('adminPasswordConfirmInput');

    if (actionInput) actionInput.value = 'edit';
    if (editUsernameInput) editUsernameInput.value = session.user || '';
    if (titleEl) {
        titleEl.innerHTML = '<i class="fas fa-key mr-2 text-sky-400"></i>Ganti Password';
    }
    if (usernameLabel) usernameLabel.textContent = 'Username';
    if (passwordLabel) passwordLabel.textContent = 'Password Baru';
    if (usernameInput) usernameInput.value = session.user || '';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';

    modal.classList.add('active');
    modal.classList.remove('hidden');
}

function closeAdminProfileModal() {
    const modal = document.getElementById('adminProfileModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.add('hidden');
    }
    const usernameInput = document.getElementById('adminUsernameInput');
    const passwordInput = document.getElementById('adminPasswordInput');
    const confirmInput = document.getElementById('adminPasswordConfirmInput');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
}

function toggleVisibility(inputId, iconId) {
    const inputEl = document.getElementById(inputId);
    const iconEl = document.getElementById(iconId);
    if (inputEl && iconEl) {
        if (inputEl.type === 'password') {
            inputEl.type = 'text';
            iconEl.classList.remove('fa-eye');
            iconEl.classList.add('fa-eye-slash');
        } else {
            inputEl.type = 'password';
            iconEl.classList.remove('fa-eye-slash');
            iconEl.classList.add('fa-eye');
        }
    }
}

async function saveAdminProfile(e) {
    e.preventDefault();
    if (savingAdminProfile) return;
    const action = document.getElementById('adminActionType')?.value || 'add';
    const editUsername = document.getElementById('adminEditUsername')?.value || '';
    const newUsername = document.getElementById('adminUsernameInput').value.trim();
    const newPassword = document.getElementById('adminPasswordInput').value.trim();
    const confirmPassword = document.getElementById('adminPasswordConfirmInput').value.trim();

    if (!newUsername || !newPassword) {
        showAlert("Username dan Password tidak boleh kosong!", false);
        return;
    }
    if (newPassword !== confirmPassword) {
        showAlert("Konfirmasi password tidak cocok!", false);
        return;
    }

    savingAdminProfile = true;
    const submitBtn = e.target && e.target.querySelector
        ? e.target.querySelector('button[type="submit"]')
        : null;
    if (submitBtn) submitBtn.disabled = true;
    try {
        if (action === 'edit') {
            await updateAdminCredentials(editUsername, newUsername, newPassword);
            showAlert("Data admin berhasil diperbarui!", true);
        } else {
            const token = getAdminSessionToken();
            if (!token) throw new Error('Sesi admin tidak valid. Silakan login ulang.');
            const { data, error } = await db.rpc('create_admin', {
                p_session_token: token,
                p_username: newUsername,
                p_password: newPassword
            });
            if (error) throw error;
            if (!data || !data.success) {
                throw new Error(data?.error || 'Gagal menambah admin');
            }
            showAlert("Admin baru berhasil ditambahkan!", true);
        }
        closeAdminProfileModal();
        await loadAdminData(true);
    } catch (err) {
        console.error("Error saving admin:", err);
        const msg = (err.message || '').includes('create_admin')
            ? 'RPC create_admin belum ada. Jalankan Database/schema.sql di Supabase SQL Editor.'
            : `Gagal menyimpan data admin: ${err.message}`;
        showAlert(msg, false);
    } finally {
        savingAdminProfile = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}

function deleteAdmin(username) {
    const session = getAdminSession() || {};
    if (session.user === username) {
        showAlert('Anda tidak dapat menghapus akun admin yang sedang digunakan.', false);
        return;
    }

    showModal(
        "Hapus Admin",
        `Apakah Anda yakin ingin menghapus akun admin <strong>${escapeHtml(username)}</strong>?`,
        true,
        "Hapus",
        async () => {
            try {
                const token = getAdminSessionToken();
                if (!token) throw new Error('Sesi admin tidak valid. Silakan login ulang.');
                const { data, error } = await db.rpc('delete_admin', {
                    p_session_token: token,
                    p_username: username
                });
                if (error) throw error;
                if (!data || !data.success) {
                    throw new Error(data?.error || 'Gagal menghapus admin');
                }
                showAlert(`Admin ${username} berhasil dihapus!`, true);
                await loadAdminData(true);
            } catch (err) {
                console.error("Error deleting admin:", err);
                showAlert(`Gagal menghapus admin: ${err.message}`, false);
            }
        }
    );
}

async function verifyAdminSessionOrRedirect() {
    const session = getAdminSession();
    if (!session || !session.token) {
        clearAdminSession();
        window.location.replace('index.html');
        return false;
    }
    try {
        const { data, error } = await db.rpc('verify_admin_session', {
            p_session_token: session.token
        });
        if (error || !data || !data.success) {
            clearAdminSession();
            window.location.replace('index.html');
            return false;
        }
        if (data.username && data.username !== session.user) {
            setAdminSession(data.username, session.token);
        }
        return true;
    } catch (e) {
        console.error('Verifikasi sesi admin gagal:', e);
        clearAdminSession();
        window.location.replace('index.html');
        return false;
    }
}

(async function initAdminPage() {
    const ok = await verifyAdminSessionOrRedirect();
    if (!ok) return;
    try {
        const session = getAdminSession();
        if (session && session.user) {
            const el = document.getElementById('headerAdminName');
            if (el) el.textContent = session.user;
        }
    } catch (e) { }
    switchView('dashboard');
})();
