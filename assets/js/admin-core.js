'use strict';

let activeVoterType = 'siswa';
let voterLoadSeq = 0;
let voterModalSeq = 0;
let modalVoterType = 'siswa';
let candidateRenderSeq = 0;
let candidateLoadSeq = 0;
let candidateModalSeq = 0;
let savingCandidate = false;
let candidatePhotoBusy = false;
let bulkDestructiveBusy = false;
let savingVoter = false;
let importingExcel = false;
let importingWord = false;
let generatingVoterCards = false;
let committingSettings = false;
let savingAdminProfile = false;
let savingJadwal = false;
let voterSearchKeyword = '';
let voterClassFilter = '';
let voterCurrentPage = 1;
let voterLimitPerPage = 10;
let voterPageRecords = [];
let voterTotalRecords = 0;
let voterSearchDebounceTimer = null;
let activeAdminView = 'dashboard';
let lastPemilihSubType = 'pemilih-siswa';
let appConfigLoaded = false;
let allCandidateRecords = [];

function getVoterAppBaseUrl() {
    return new URL('./', window.location.href).href;
}

function numOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function displayOrZero(value) {
    if (value == null) return '0';
    const s = String(value).trim();
    return s === '' || s === '-' ? '0' : s;
}

function isProtectedDefaultAsset(url) {
    if (!url) return true;
    return url === DEFAULT_SYSTEM_SETTINGS.schoolLogo || url === DEFAULT_SYSTEM_SETTINGS.loginBg;
}

function getConfiguredSchoolName() {
    return AppStorage.get('ep_sh_name') || DEFAULT_SYSTEM_SETTINGS.schoolName;
}

const UI = {
    alert: document.getElementById('loginAlertBox'),
    mod: document.getElementById('customModal'),
    mTitle: document.getElementById('customModalTitle'),
    mBody: document.getElementById('customModalBody'),
    mCancel: document.getElementById('modalBtnCancel'),
    mConfirm: document.getElementById('modalBtnConfirm'),
    inputName: document.getElementById('inputSchoolName'),
    inputExam: document.getElementById('inputExamTitle'),
    inputLoginQueue: document.getElementById('inputLoginQueueProfile'),
    inputActiveVoterLimitEnabled: document.getElementById('inputActiveVoterLimitEnabled'),
    inputMaxActiveVoters: document.getElementById('inputMaxActiveVoters'),
    inputVotingBoothDuration: document.getElementById('inputVotingBoothDuration'),
    inputVotingWaitTimeout: document.getElementById('inputVotingWaitTimeout'),
    logoUploadStatus: document.getElementById('logoUploadStatus'),
    bgUploadStatus: document.getElementById('bgUploadStatus'),
    logoPreview: document.getElementById('settingsLogoPreview'),
    bgPreview: document.getElementById('settingsBgPreview')
};
let modalCb = null;
function showModal(title, body, showCancel, btnText, callback) {
    UI.mTitle.textContent = title; UI.mBody.innerHTML = body; UI.mConfirm.textContent = btnText;
    UI.mCancel.style.display = showCancel ? 'block' : 'none'; modalCb = callback;
    if (UI.mConfirm) UI.mConfirm.disabled = false;
    UI.mod.classList.add('active');
}
if (UI.mCancel) UI.mCancel.onclick = () => { UI.mod.classList.remove('active'); modalCb = null; };
if (UI.mConfirm) UI.mConfirm.onclick = async () => {
    const cb = modalCb;
    modalCb = null;
    UI.mod.classList.remove('active');
    if (UI.mConfirm) UI.mConfirm.disabled = true;
    if (!cb) return;
    try {
        await cb();
    } catch (err) {
        console.error('Modal confirm error:', err);
    } finally {
        if (UI.mConfirm) UI.mConfirm.disabled = false;
    }
};

async function renderConfiguredSettings() {
    const currentName = AppStorage.get('ep_sh_name') || DEFAULT_SYSTEM_SETTINGS.schoolName;
    const currentExam = AppStorage.get('ep_ex_title') || DEFAULT_SYSTEM_SETTINGS.examTitle;
    const currentLogoId = AppStorage.get('ep_sh_logo') || DEFAULT_SYSTEM_SETTINGS.schoolLogo;
    const currentBgId = AppStorage.get('ep_login_bg') || DEFAULT_SYSTEM_SETTINGS.loginBg;
    document.querySelectorAll('.global-school-name').forEach(el => el.textContent = currentName);
    const headerExamText = document.getElementById('headerExamTitle');
    if (headerExamText) headerExamText.textContent = currentExam;
    if (UI.inputName) UI.inputName.value = currentName;
    if (UI.inputExam) UI.inputExam.value = currentExam;
    if (UI.inputLoginQueue) {
        const queueProfile = AppStorage.get(LOGIN_QUEUE_PROFILE_KEY) || 'free';
        UI.inputLoginQueue.value = queueProfile === 'pro' ? 'pro' : 'free';
    }
    if (UI.inputActiveVoterLimitEnabled) {
        const enabledRaw = AppStorage.get('pilkasis_voter_capacity_enabled');
        UI.inputActiveVoterLimitEnabled.checked = enabledRaw !== 'false';
    }
    if (UI.inputMaxActiveVoters) {
        const limitRaw = AppStorage.get('pilkasis_voter_capacity_limit');
        const queueProfile = AppStorage.get(LOGIN_QUEUE_PROFILE_KEY) || 'free';
        const fallbackLimit = queueProfile === 'pro' ? 200 : 80;
        UI.inputMaxActiveVoters.value = String(Math.max(10, Math.min(500, Number(limitRaw) || fallbackLimit)));
    }
    if (UI.inputVotingBoothDuration) {
        const durationRaw = AppStorage.get(VOTING_BOOTH_DURATION_KEY);
        UI.inputVotingBoothDuration.value = String(Math.max(1, Math.min(60, Number(durationRaw) || 5)));
    }
    if (UI.inputVotingWaitTimeout) {
        const waitRaw = AppStorage.get(VOTING_WAIT_TIMEOUT_KEY);
        UI.inputVotingWaitTimeout.value = String(Math.max(1, Math.min(60, Number(waitRaw) || 15)));
    }
    const activeLogoText = document.getElementById('activeLogoText');
    const activeBgText = document.getElementById('activeBgText');
    const extractDisplay = (str) => {
        if (!str) return '';
        if (str.startsWith('http')) return str.substring(str.lastIndexOf('/') + 1).substring(0, 15);
        if (str.startsWith('data:')) return 'Base64Data';
        return str;
    };
    if (activeLogoText) {
        activeLogoText.textContent = window.tempUploadedLogo
            ? window.tempUploadedLogo.id
            : extractDisplay(currentLogoId);
    }
    if (activeBgText) {
        activeBgText.textContent = window.tempUploadedBg
            ? window.tempUploadedBg.id
            : extractDisplay(currentBgId);
    }
    const resolvedLogo = await resolveImage(currentLogoId);
    if (resolvedLogo) {
        const logoEl = document.getElementById('headerLogo');
        if (logoEl) logoEl.src = resolvedLogo;
        const faviconEl = document.getElementById('appFavicon');
        if (faviconEl) faviconEl.href = resolvedLogo;
    }
    if (UI.logoPreview) {
        UI.logoPreview.src = (window.tempUploadedLogo && window.tempUploadedLogo.data)
            || resolvedLogo
            || UI.logoPreview.src;
    }
    if (UI.bgPreview) {
        if (window.tempUploadedBg && window.tempUploadedBg.data) {
            UI.bgPreview.src = window.tempUploadedBg.data;
        } else {
            const resolvedBg = await resolveImage(currentBgId);
            if (resolvedBg) UI.bgPreview.src = resolvedBg;
        }
    }
}
const IMAGE_COMPRESS_MAX_KB = 100;
const IMAGE_COMPRESS_PHOTO_MAX_DIM = 1200;
const IMAGE_COMPRESS_MIN_DIM = 200;

function estimateDataUrlKb(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : String(dataUrl || '');
    const padding = (b64.match(/=+$/) || [''])[0].length;
    return Math.max(0, ((b64.length * 3) / 4 - padding) / 1024);
}

function makeShortImageId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let shortId = '';
    for (let i = 0; i < 10; i++) shortId += chars.charAt(Math.floor(Math.random() * chars.length));
    return shortId;
}

function compressDataUrlToLimit(dataUrl, maxDimension, targetKb = IMAGE_COMPRESS_MAX_KB, options = {}) {
    const keepAlpha = !!options.keepAlpha;
    const hardLimit = Math.max(20, Number(targetKb) || IMAGE_COMPRESS_MAX_KB);
    const startDim = Math.max(IMAGE_COMPRESS_MIN_DIM, Number(maxDimension) || IMAGE_COMPRESS_PHOTO_MAX_DIM);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function () {
            const srcW = img.naturalWidth || img.width || 1;
            const srcH = img.naturalHeight || img.height || 1;

            const drawAt = (maxDim, quality, asPng) => {
                const canvas = document.createElement('canvas');
                let width = srcW;
                let height = srcH;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = height * maxDim / width;
                        width = maxDim;
                    } else {
                        width = width * maxDim / height;
                        height = maxDim;
                    }
                }
                width = Math.max(1, Math.round(width));
                height = Math.max(1, Math.round(height));
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                if (asPng) {
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    const out = canvas.toDataURL('image/png');
                    return { out, kb: estimateDataUrlKb(out) };
                }

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                const out = canvas.toDataURL('image/jpeg', quality);
                return { out, kb: estimateDataUrlKb(out) };
            };

            let bestUnder = null;
            let fallback = null;

            const consider = (result) => {
                if (!result || !result.out) return;
                if (!fallback || result.kb < fallback.kb) fallback = result;
                if (result.kb <= hardLimit) {
                    if (!bestUnder || result.kb > bestUnder.kb) bestUnder = result;
                }
            };

            if (keepAlpha) {
                let dim = startDim;
                while (dim >= IMAGE_COMPRESS_MIN_DIM) {
                    consider(drawAt(dim, 1, true));
                    if (bestUnder) break;
                    dim = Math.max(IMAGE_COMPRESS_MIN_DIM, Math.round(dim * 0.82));
                    if (dim === IMAGE_COMPRESS_MIN_DIM) {
                        consider(drawAt(IMAGE_COMPRESS_MIN_DIM, 1, true));
                        break;
                    }
                }
                if (!bestUnder) {
                    let dimJpg = startDim;
                    let quality = 0.9;
                    while (dimJpg >= IMAGE_COMPRESS_MIN_DIM) {
                        quality = 0.9;
                        while (quality >= 0.42) {
                            consider(drawAt(dimJpg, quality, false));
                            if (bestUnder) break;
                            quality = Math.round((quality - 0.06) * 100) / 100;
                        }
                        if (bestUnder) break;
                        const next = Math.max(IMAGE_COMPRESS_MIN_DIM, Math.round(dimJpg * 0.82));
                        if (next === dimJpg) break;
                        dimJpg = next;
                    }
                }
            } else {
                let dim = startDim;
                while (dim >= IMAGE_COMPRESS_MIN_DIM) {
                    let quality = 0.92;
                    let atDim = drawAt(dim, quality, false);
                    consider(atDim);

                    if (atDim.kb > hardLimit) {
                        let lo = 0.42;
                        let hi = 0.92;
                        for (let i = 0; i < 8; i++) {
                            const mid = Math.round(((lo + hi) / 2) * 100) / 100;
                            const trial = drawAt(dim, mid, false);
                            consider(trial);
                            if (trial.kb > hardLimit) hi = mid;
                            else lo = mid;
                        }
                        consider(drawAt(dim, lo, false));
                    }

                    if (bestUnder) break;

                    const next = Math.max(IMAGE_COMPRESS_MIN_DIM, Math.round(dim * 0.85));
                    if (next === dim) {
                        consider(drawAt(IMAGE_COMPRESS_MIN_DIM, 0.4, false));
                        break;
                    }
                    dim = next;
                }
            }

            const chosen = bestUnder || fallback;
            if (!chosen || !chosen.out) {
                reject(new Error('Gagal mengompres gambar'));
                return;
            }

            resolve({
                data: chosen.out,
                shortId: makeShortImageId(),
                sizeKb: Math.max(1, Math.round(chosen.kb))
            });
        };
        img.onerror = () => reject(new Error('Gagal memuat gambar untuk kompresi'));
        img.src = dataUrl;
    });
}

function compressImageToLimit(file, maxDimension, targetKb, callback, onError, options) {
    const fail = (err) => {
        console.error(err);
        showAlert('Gagal mengolah/mengompres gambar.', false);
        if (typeof onError === 'function') onError(err);
    };
    const reader = new FileReader();
    reader.onload = function (e) {
        compressDataUrlToLimit(e.target.result, maxDimension, targetKb || IMAGE_COMPRESS_MAX_KB, options || {})
            .then(({ data, shortId, sizeKb }) => callback(data, shortId, sizeKb))
            .catch(fail);
    };
    reader.onerror = function () {
        fail(new Error('Gagal membaca file gambar dari perangkat.'));
    };
    reader.readAsDataURL(file);
}
function processLogoFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    if (UI.logoUploadStatus) {
        UI.logoUploadStatus.textContent = "Sedang memproses logo (maks. 100 KB)...";
        UI.logoUploadStatus.className = "font-semibold text-yellow-600";
    }

    const maxDim = 800;
    const resetStatus = () => {
        if (!UI.logoUploadStatus) return;
        UI.logoUploadStatus.textContent = "Klik untuk mengunggah logo baru...";
        UI.logoUploadStatus.className = "font-medium text-gray-600";
    };
    compressImageToLimit(file, maxDim, IMAGE_COMPRESS_MAX_KB, function (base64Data, shortId, sizeInKb) {
        const isPng = String(base64Data).startsWith('data:image/png');
        const uniqueName = `logo_${shortId}.${isPng ? 'png' : 'jpg'}`;
        window.tempUploadedLogo = { id: uniqueName, data: base64Data };
        if (UI.logoPreview) UI.logoPreview.src = base64Data;
        const activeLogoText = document.getElementById('activeLogoText');
        if (activeLogoText) activeLogoText.textContent = uniqueName;
        if (UI.logoUploadStatus) {
            UI.logoUploadStatus.textContent = `Logo siap: ${uniqueName} (${sizeInKb} KB / maks. 100). Klik Simpan!`;
            UI.logoUploadStatus.className = "font-bold text-emerald-600";
        }
        showAlert(`Berkas logo berhasil dikompres ke ${sizeInKb} KB (maks. 100 KB)!`, true);
    }, resetStatus, { keepAlpha: true });
}
function processLoginBgFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    if (UI.bgUploadStatus) {
        UI.bgUploadStatus.textContent = "Mengompres gambar (maks. 100 KB)...";
        UI.bgUploadStatus.className = "font-semibold text-yellow-600";
    }

    const maxDim = 1920;
    const resetStatus = () => {
        if (!UI.bgUploadStatus) return;
        UI.bgUploadStatus.textContent = "Klik untuk mengunggah gambar latar belakang baru...";
        UI.bgUploadStatus.className = "font-medium text-gray-600";
    };
    compressImageToLimit(file, maxDim, IMAGE_COMPRESS_MAX_KB, function (base64Data, shortId, sizeInKb) {
        const uniqueName = `bg_${shortId}.jpg`;
        window.tempUploadedBg = { id: uniqueName, data: base64Data };
        if (UI.bgPreview) UI.bgPreview.src = base64Data;
        const activeBgText = document.getElementById('activeBgText');
        if (activeBgText) activeBgText.textContent = uniqueName;
        if (UI.bgUploadStatus) {
            UI.bgUploadStatus.textContent = `Background siap: ${uniqueName} (${sizeInKb} KB / maks. 100). Klik Simpan!`;
            UI.bgUploadStatus.className = "font-bold text-emerald-600";
        }
        showAlert(`Latar belakang berhasil dikompres ke ${sizeInKb} KB (maks. 100 KB)!`, true);
    }, resetStatus);
}
async function commitSettings(options = {}) {
    if (committingSettings) return;
    const forceDefaults = !!options.forceDefaults;
    if (!forceDefaults && !appConfigLoaded) {
        try {
            await fetchAppConfiguration();
        } catch (err) {
            showAlert('Gagal memuat konfigurasi dari server. Coba lagi.', false);
            return;
        }
        if (!appConfigLoaded) {
            showAlert('Konfigurasi server belum siap. Coba lagi.', false);
            return;
        }
    }
    const previousLogo = AppStorage.get('ep_sh_logo') || DEFAULT_SYSTEM_SETTINGS.schoolLogo;
    const previousBg = AppStorage.get('ep_login_bg') || DEFAULT_SYSTEM_SETTINGS.loginBg;
    const targetName = forceDefaults
        ? DEFAULT_SYSTEM_SETTINGS.schoolName
        : (UI.inputName.value.trim() || DEFAULT_SYSTEM_SETTINGS.schoolName);
    const targetExam = forceDefaults
        ? DEFAULT_SYSTEM_SETTINGS.examTitle
        : (UI.inputExam.value.trim() || DEFAULT_SYSTEM_SETTINGS.examTitle);
    let targetLogo = forceDefaults ? DEFAULT_SYSTEM_SETTINGS.schoolLogo : previousLogo;
    let targetBg = forceDefaults ? DEFAULT_SYSTEM_SETTINGS.loginBg : previousBg;
    let uploadedLogoUrl = null;
    let uploadedBgUrl = null;
    committingSettings = true;
    try {
        if (!forceDefaults && window.tempUploadedLogo) {
            uploadedLogoUrl = await saveImage('settings', window.tempUploadedLogo.id, window.tempUploadedLogo.data);
            targetLogo = uploadedLogoUrl;
        }
        if (!forceDefaults && window.tempUploadedBg) {
            uploadedBgUrl = await saveImage('settings', window.tempUploadedBg.id, window.tempUploadedBg.data);
            targetBg = uploadedBgUrl;
        }
        const { error: settingsErr } = await db.from('pengaturan').upsert({
            id: 'konfigurasi_aplikasi',
            school_name: targetName,
            exam_title: targetExam,
            school_logo: targetLogo,
            login_bg: targetBg,
            updated_at: new Date().toISOString()
        });
        if (settingsErr) throw settingsErr;

        const targetQueueProfile = forceDefaults
            ? 'free'
            : ((UI.inputLoginQueue && UI.inputLoginQueue.value === 'pro') ? 'pro' : 'free');
        const { error: queueErr } = await db.from('pengaturan').upsert({
            id: LOGIN_QUEUE_SETTINGS_ID,
            mode: targetQueueProfile,
            active: true,
            updated_at: new Date().toISOString()
        });
        if (queueErr) throw queueErr;

        const targetCapacityEnabled = forceDefaults
            ? true
            : !!(UI.inputActiveVoterLimitEnabled && UI.inputActiveVoterLimitEnabled.checked);
        const targetCapacityLimit = forceDefaults
            ? 80
            : Math.max(10, Math.min(500, Number(UI.inputMaxActiveVoters && UI.inputMaxActiveVoters.value) || (targetQueueProfile === 'pro' ? 200 : 80)));
        const { error: capacityErr } = await db.from('pengaturan').upsert({
            id: VOTER_CAPACITY_SETTINGS_ID,
            mode: String(targetCapacityLimit),
            active: targetCapacityEnabled,
            updated_at: new Date().toISOString()
        });
        if (capacityErr) throw capacityErr;

        const targetVotingBoothDuration = forceDefaults
            ? 5
            : Math.max(1, Math.min(60, Number(UI.inputVotingBoothDuration && UI.inputVotingBoothDuration.value) || 5));
        const { error: boothDurationErr } = await db.from('pengaturan').upsert({
            id: VOTING_BOOTH_DURATION_SETTINGS_ID,
            mode: String(targetVotingBoothDuration),
            active: true,
            updated_at: new Date().toISOString()
        });
        if (boothDurationErr) throw boothDurationErr;

        const targetVotingWaitTimeout = forceDefaults
            ? 15
            : Math.max(1, Math.min(60, Number(UI.inputVotingWaitTimeout && UI.inputVotingWaitTimeout.value) || 15));
        const { error: waitTimeoutErr } = await db.from('pengaturan').upsert({
            id: VOTING_WAIT_SETTINGS_ID,
            mode: String(targetVotingWaitTimeout),
            active: true,
            updated_at: new Date().toISOString()
        });
        if (waitTimeoutErr) throw waitTimeoutErr;

        AppStorage.set('ep_sh_name', targetName);
        AppStorage.set('ep_ex_title', targetExam);
        AppStorage.set('ep_sh_logo', targetLogo);
        AppStorage.set('ep_login_bg', targetBg);
        AppStorage.set(LOGIN_QUEUE_PROFILE_KEY, targetQueueProfile);
        AppStorage.set('pilkasis_voter_capacity_enabled', targetCapacityEnabled ? 'true' : 'false');
        AppStorage.set('pilkasis_voter_capacity_limit', String(targetCapacityLimit));
        AppStorage.set(VOTING_BOOTH_DURATION_KEY, String(targetVotingBoothDuration));
        AppStorage.set(VOTING_WAIT_TIMEOUT_KEY, String(targetVotingWaitTimeout));

        if (targetLogo !== previousLogo && !isProtectedDefaultAsset(previousLogo)) {
            try { await deleteStoredImage(previousLogo); } catch (e) {}
        }
        if (targetBg !== previousBg && !isProtectedDefaultAsset(previousBg)) {
            try { await deleteStoredImage(previousBg); } catch (e) {}
        }

        if (UI.inputName) UI.inputName.value = targetName;
        if (UI.inputExam) UI.inputExam.value = targetExam;
        window.tempUploadedLogo = null;
        window.tempUploadedBg = null;
        await renderConfiguredSettings();
        if (UI.logoUploadStatus) {
            UI.logoUploadStatus.textContent = "Klik untuk mengunggah logo baru...";
            UI.logoUploadStatus.className = "font-medium text-gray-600";
        }
        if (UI.bgUploadStatus) {
            UI.bgUploadStatus.textContent = "Klik untuk mengunggah gambar latar belakang baru...";
            UI.bgUploadStatus.className = "font-medium text-gray-600";
        }
        showAlert(
            forceDefaults
                ? "Pengaturan dikembalikan ke default dan disinkronkan ke database!"
                : "Konfigurasi aplikasi berhasil disimpan dan disinkronkan ke database!",
            true
        );
    } catch (error) {
        console.error("Error saving settings to Supabase:", error);
        if (uploadedLogoUrl) {
            try { await deleteStoredImage(uploadedLogoUrl); } catch (e) {}
        }
        if (uploadedBgUrl) {
            try { await deleteStoredImage(uploadedBgUrl); } catch (e) {}
        }
        showAlert("Gagal menyinkronkan ke database. Periksa koneksi atau izin.", false);
    } finally {
        committingSettings = false;
    }
}
async function resetSettingsToDefault() {
    if (committingSettings) {
        showAlert('Penyimpanan pengaturan masih berjalan. Tunggu hingga selesai.', false);
        return;
    }
    showModal(
        "Reset ke Default",
        "Apakah Anda yakin ingin mengembalikan semua pengaturan ke default? Nama sekolah, judul pemilihan, logo, dan latar belakang kustom akan diganti dengan nilai default.",
        true,
        "Reset",
        async () => {
            if (committingSettings) return;
            UI.inputName.value = DEFAULT_SYSTEM_SETTINGS.schoolName;
            UI.inputExam.value = DEFAULT_SYSTEM_SETTINGS.examTitle;
            window.tempUploadedLogo = null;
            window.tempUploadedBg = null;
            await commitSettings({ forceDefaults: true });
        }
    );
}
async function fetchAppConfiguration() {
    try {
        const [appRes, queueRes, capacityRes, boothDurationRes, waitTimeoutRes] = await Promise.all([
            db.from('pengaturan').select(DB_SELECT.PENGATURAN_APP).eq('id', 'konfigurasi_aplikasi').single(),
            db.from('pengaturan').select(DB_SELECT.LOGIN_QUEUE).eq('id', LOGIN_QUEUE_SETTINGS_ID).maybeSingle(),
            db.from('pengaturan').select(DB_SELECT.VOTER_CAPACITY).eq('id', VOTER_CAPACITY_SETTINGS_ID).maybeSingle(),
            db.from('pengaturan').select(DB_SELECT.VOTING_DURATION).eq('id', VOTING_BOOTH_DURATION_SETTINGS_ID).maybeSingle(),
            db.from('pengaturan').select(DB_SELECT.VOTING_WAIT).eq('id', VOTING_WAIT_SETTINGS_ID).maybeSingle()
        ]);
        const data = appRes.data;
        const error = appRes.error;
        if (!error && data) {
            if (data.school_name) AppStorage.set('ep_sh_name', data.school_name);
            if (data.exam_title) AppStorage.set('ep_ex_title', data.exam_title);
            if (data.school_logo) AppStorage.set('ep_sh_logo', data.school_logo);
            if (data.login_bg) AppStorage.set('ep_login_bg', data.login_bg);
        }
        if (!queueRes.error && queueRes.data && (queueRes.data.mode === 'free' || queueRes.data.mode === 'pro')) {
            AppStorage.set(LOGIN_QUEUE_PROFILE_KEY, queueRes.data.mode);
        } else {
            AppStorage.set(LOGIN_QUEUE_PROFILE_KEY, 'free');
        }
        if (!capacityRes.error && capacityRes.data) {
            AppStorage.set('pilkasis_voter_capacity_enabled', capacityRes.data.active === false ? 'false' : 'true');
            if (capacityRes.data.mode) {
                AppStorage.set('pilkasis_voter_capacity_limit', String(capacityRes.data.mode));
            }
        } else {
            AppStorage.set('pilkasis_voter_capacity_enabled', 'true');
            AppStorage.set('pilkasis_voter_capacity_limit', '80');
        }
        if (!boothDurationRes.error && boothDurationRes.data && boothDurationRes.data.mode) {
            AppStorage.set(VOTING_BOOTH_DURATION_KEY, String(boothDurationRes.data.mode));
        } else {
            AppStorage.set(VOTING_BOOTH_DURATION_KEY, '5');
        }
        if (!waitTimeoutRes.error && waitTimeoutRes.data && waitTimeoutRes.data.mode) {
            AppStorage.set(VOTING_WAIT_TIMEOUT_KEY, String(waitTimeoutRes.data.mode));
        } else {
            AppStorage.set(VOTING_WAIT_TIMEOUT_KEY, '15');
        }
        await renderConfiguredSettings();
        appConfigLoaded = true;
    } catch (err) {
        console.warn("Gagal menyinkronkan konfigurasi cloud di awal:", err);
    }
}
const VOTER_PASSWORD_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
function toggleVoterPasswordVisibility(button, plainPassword) {
    const span = button.previousElementSibling;
    const icon = button.querySelector('i');
    if (!span || !icon) return;
    if (span.textContent === VOTER_PASSWORD_MASK) {
        span.textContent = plainPassword;
        icon.className = 'fas fa-eye-slash text-xs';
    } else {
        span.textContent = VOTER_PASSWORD_MASK;
        icon.className = 'fas fa-eye text-xs';
    }
}

function bindAdminTableDelegation() {
    if (bindAdminTableDelegation._bound) return;
    bindAdminTableDelegation._bound = true;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-table-action]');
        if (!btn) return;
        const action = btn.dataset.tableAction;
        switch (action) {
            case 'edit-voter':
                openVoterModal('edit', btn.dataset.recordId || '');
                break;
            case 'delete-voter':
                deleteVoter(btn.dataset.recordId || '', btn.dataset.recordName || '');
                break;
            case 'reset-voter':
                resetVoterVotes(btn.dataset.recordId || '', btn.dataset.recordName || '');
                break;
            case 'edit-candidate':
                openCandidateModal('edit', btn.dataset.recordId || '');
                break;
            case 'delete-candidate':
                deleteCandidate(btn.dataset.recordId || '', btn.dataset.recordName || '');
                break;
            case 'edit-admin':
                openAdminModal('edit', btn.dataset.recordUsername || '');
                break;
            case 'delete-admin':
                deleteAdmin(btn.dataset.recordUsername || '');
                break;
            case 'toggle-password':
                toggleVoterPasswordVisibility(btn, btn.dataset.password || '');
                break;
        }
    });
}

let alertTimeout = null;
function showAlert(msg, isSuccess = false) {
    if (alertTimeout) {
        clearTimeout(alertTimeout);
    }
    UI.alert.textContent = msg;
    UI.alert.style.display = 'block';
    UI.alert.className = `alert-box ${isSuccess ? 'alert-success' : 'alert-error'}`;
    alertTimeout = setTimeout(() => {
        UI.alert.style.display = 'none';
    }, 2000);
}

async function initializeAdminInteractions() {
    bindAdminTableDelegation();
    await renderConfiguredSettings();
    const toggleVoterFormPasswordBtn = document.getElementById('toggleVoterFormPasswordBtn');
    if (toggleVoterFormPasswordBtn) {
        toggleVoterFormPasswordBtn.onclick = () => {
            const input = document.getElementById('voterPasswordInput');
            const icon = document.getElementById('voterFormPasswordIcon');
            input.type = input.type === 'password' ? 'text' : 'password';
            icon.className = input.type === 'password' ? 'fas fa-eye text-xs' : 'fas fa-eye-slash text-xs';
        };
    }
    try {
        await fetchAppConfiguration();
    } catch (err) {
        console.warn("Gagal fetch konfigurasi awal:", err);
    }
    if (UI.inputLoginQueue && UI.inputMaxActiveVoters && !UI.inputLoginQueue.dataset.boundCapacitySuggest) {
        UI.inputLoginQueue.dataset.boundCapacitySuggest = '1';
        UI.inputLoginQueue.addEventListener('change', () => {
            if (!UI.inputMaxActiveVoters) return;
            UI.inputMaxActiveVoters.value = UI.inputLoginQueue.value === 'pro' ? '200' : '80';
            if (UI.inputActiveVoterLimitEnabled) UI.inputActiveVoterLimitEnabled.checked = true;
        });
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('sidebar').classList.toggle('collapsed');
        };
    }

    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (mobileMenuToggle && sidebar && sidebarOverlay) {
        mobileMenuToggle.onclick = (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        };
        sidebarOverlay.onclick = () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        };

        sidebar.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                sidebar.classList.remove('open');
                sidebarOverlay.classList.remove('active');
            });
        });
    }

    document.querySelectorAll('.btnLogout').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            const token = getAdminSessionToken();
            try {
                if (token) await db.rpc('logout_admin', { p_session_token: token });
            } catch (err) {
                console.warn('logout_admin:', err);
            }
            clearAdminSession();
            window.location.replace('index.html');
        };
    });

    if (activeAdminView === 'jadwal') loadJadwalPengaturan();
}

document.addEventListener('DOMContentLoaded', initializeAdminInteractions);

window.addEventListener('resize', () => {
    if (typeof updateMobileFormattedNames === 'function') updateMobileFormattedNames();
});
window.addEventListener('orientationchange', () => {
    if (typeof updateMobileFormattedNames === 'function') updateMobileFormattedNames();
});

function switchView(viewId) {
    activeAdminView = viewId;
    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('block');
    });
    let targetView = document.getElementById(`view-${viewId}`);
    if (!targetView) {
        console.warn('View admin tidak ditemukan:', viewId, '— kembali ke dashboard.');
        activeAdminView = 'dashboard';
        viewId = 'dashboard';
        targetView = document.getElementById('view-dashboard');
    }
    if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('block');
    }
    const deskDashboard = document.getElementById('nav-dashboard');
    const deskPemilih = document.getElementById('nav-pemilih');
    const deskKandidat = document.getElementById('nav-kandidat');
    const deskAdmin = document.getElementById('nav-admin');
    const deskJadwal = document.getElementById('nav-jadwal');
    const deskPengaturan = document.getElementById('nav-pengaturan');
    const resetDesktopStyle = (el, iconClass) => {
        if (!el) return;
        el.className = "sidebar-menu-link group flex items-center px-3 py-2.5 mx-3 mb-1 rounded-md text-[#b5cbdf] hover:text-white transition-all";
        const iEl = el.querySelector('i');
        if (iEl) iEl.className = `fas ${iconClass} w-6 text-center text-[#9db9d8] group-hover:text-white transition-colors`;
    };
    resetDesktopStyle(deskDashboard, 'fa-th-large');
    resetDesktopStyle(deskPemilih, 'fa-users');
    resetDesktopStyle(deskKandidat, 'fa-user-tie');
    resetDesktopStyle(deskAdmin, 'fa-user-shield');
    resetDesktopStyle(deskJadwal, 'fa-calendar-alt');
    resetDesktopStyle(deskPengaturan, 'fa-cogs');
    if (viewId === 'dashboard' && deskDashboard) {
        deskDashboard.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskDashboard.querySelector('i');
        if (iEl) iEl.className = "fas fa-th-large w-6 text-center text-[#38bdf8]";
    } else if (viewId === 'pemilih' && deskPemilih) {
        deskPemilih.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskPemilih.querySelector('i');
        if (iEl) iEl.className = "fas fa-users w-6 text-center text-[#38bdf8]";
    } else if (viewId === 'kandidat' && deskKandidat) {
        deskKandidat.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskKandidat.querySelector('i');
        if (iEl) iEl.className = "fas fa-user-tie w-6 text-center text-[#38bdf8]";
    } else if (viewId === 'admin' && deskAdmin) {
        deskAdmin.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskAdmin.querySelector('i');
        if (iEl) iEl.className = "fas fa-user-shield w-6 text-center text-[#38bdf8]";
    } else if (viewId === 'jadwal' && deskJadwal) {
        deskJadwal.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskJadwal.querySelector('i');
        if (iEl) iEl.className = "fas fa-calendar-alt w-6 text-center text-[#38bdf8]";
    } else if (viewId === 'pengaturan' && deskPengaturan) {
        deskPengaturan.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskPengaturan.querySelector('i');
        if (iEl) iEl.className = "fas fa-cogs w-6 text-center text-[#38bdf8]";
    }
    const mobDashboard = document.getElementById('bnav-dashboard');
    const mobPemilih = document.getElementById('bnav-pemilih');
    const mobKandidat = document.getElementById('bnav-kandidat');
    const mobAdmin = document.getElementById('bnav-admin');
    const mobJadwal = document.getElementById('bnav-jadwal');
    const mobPengaturan = document.getElementById('bnav-pengaturan');
    const resetMobileStyle = (el) => {
        if (!el) return;
        el.classList.remove('text-[#38bdf8]');
        el.classList.add('text-[#b5cbdf]');
    };
    resetMobileStyle(mobDashboard);
    resetMobileStyle(mobPemilih);
    resetMobileStyle(mobKandidat);
    resetMobileStyle(mobAdmin);
    resetMobileStyle(mobJadwal);
    resetMobileStyle(mobPengaturan);
    if (viewId === 'dashboard' && mobDashboard) {
        mobDashboard.classList.remove('text-[#b5cbdf]');
        mobDashboard.classList.add('text-[#38bdf8]');
    } else if (viewId === 'pemilih' && mobPemilih) {
        mobPemilih.classList.remove('text-[#b5cbdf]');
        mobPemilih.classList.add('text-[#38bdf8]');
    } else if (viewId === 'kandidat' && mobKandidat) {
        mobKandidat.classList.remove('text-[#b5cbdf]');
        mobKandidat.classList.add('text-[#38bdf8]');
    } else if (viewId === 'admin' && mobAdmin) {
        mobAdmin.classList.remove('text-[#b5cbdf]');
        mobAdmin.classList.add('text-[#38bdf8]');
    } else if (viewId === 'jadwal' && mobJadwal) {
        mobJadwal.classList.remove('text-[#b5cbdf]');
        mobJadwal.classList.add('text-[#38bdf8]');
    } else if (viewId === 'pengaturan' && mobPengaturan) {
        mobPengaturan.classList.remove('text-[#b5cbdf]');
        mobPengaturan.classList.add('text-[#38bdf8]');
    }
    if (viewId !== 'pemilih') {
        const submenu = document.getElementById('pemilih-submenu-html');
        if (submenu) {
            submenu.classList.remove('flex');
            submenu.classList.add('hidden');
        }
        const arrowIcon = document.querySelector('#nav-pemilih .menu-arrow i');
        if (arrowIcon) {
            arrowIcon.classList.remove('rotate-180');
        }
        const subItems = ['nav-pemilih-siswa', 'nav-pemilih-guru', 'nav-pemilih-staf'];
        subItems.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.className = "group flex items-center pl-8 pr-3 py-2 text-xs text-[#b5cbdf] hover:text-white transition-all";
                const iEl = el.querySelector('i');
                if (iEl) iEl.className = "fas " + getSubmenuIcon(id) + " w-4 text-center text-[#9db9d8] group-hover:text-[#38bdf8] transition-colors";
                const span = el.querySelector('span');
                if (span) span.className = "ml-2 border-b border-transparent group-hover:border-[#38bdf8] pb-0.5 transition-colors menu-text";
            }
        });
    } else {
        const submenu = document.getElementById('pemilih-submenu-html');
        if (submenu && submenu.classList.contains('hidden')) {
            submenu.classList.remove('hidden');
            submenu.classList.add('flex');
            const arrowIcon = document.querySelector('#nav-pemilih .menu-arrow i');
            if (arrowIcon) arrowIcon.classList.add('rotate-180');
            switchViewHtml(lastPemilihSubType);
        }
    }
    if (viewId === 'dashboard') {
        updateDashboard();
    } else if (viewId === 'kandidat') {
        loadCandidateData();
    } else if (viewId === 'admin') {
        loadAdminData();
    }
    if (viewId === 'jadwal') {
        loadJadwalPengaturan();
    }

}
function toggleHtmlDropdown(e) {
    e.preventDefault();
    const submenu = document.getElementById('pemilih-submenu-html');
    if (!submenu) return;
    const arrowIcon = document.querySelector('#nav-pemilih .menu-arrow i');
    if (submenu.classList.contains('hidden')) {
        submenu.classList.remove('hidden');
        submenu.classList.add('flex');
        if (arrowIcon) arrowIcon.classList.add('rotate-180');
        switchViewHtml(lastPemilihSubType);
    } else {
        submenu.classList.remove('flex');
        submenu.classList.add('hidden');
        if (arrowIcon) arrowIcon.classList.remove('rotate-180');
    }
}
function switchViewHtml(subType) {
    lastPemilihSubType = subType;
    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('block');
    });
    const targetView = document.getElementById('view-pemilih');
    if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('block');
    } else {
        const dashboard = document.getElementById('view-dashboard');
        if (dashboard) {
            dashboard.classList.remove('hidden');
            dashboard.classList.add('block');
            activeAdminView = 'dashboard';
        }
    }
    const deskDashboard = document.getElementById('nav-dashboard');
    const deskPemilih = document.getElementById('nav-pemilih');
    const deskKandidat = document.getElementById('nav-kandidat');
    const deskAdmin = document.getElementById('nav-admin');
    const deskJadwal = document.getElementById('nav-jadwal');
    const deskPengaturan = document.getElementById('nav-pengaturan');
    const resetDesktopStyle = (el, iconClass) => {
        if (!el) return;
        el.className = "sidebar-menu-link group flex items-center px-3 py-2.5 mx-3 mb-1 rounded-md text-[#b5cbdf] hover:text-white transition-all";
        const iEl = el.querySelector('i');
        if (iEl) iEl.className = `fas ${iconClass} w-6 text-center text-[#9db9d8] group-hover:text-white transition-colors`;
    };
    resetDesktopStyle(deskDashboard, 'fa-th-large');
    resetDesktopStyle(deskPemilih, 'fa-users');
    resetDesktopStyle(deskKandidat, 'fa-user-tie');
    resetDesktopStyle(deskAdmin, 'fa-user-shield');
    resetDesktopStyle(deskJadwal, 'fa-calendar-alt');
    resetDesktopStyle(deskPengaturan, 'fa-cogs');
    if (deskPemilih) {
        deskPemilih.className = "flex items-center px-3 py-2.5 mx-3 mb-1 bg-white/20 text-white rounded-md border border-white/30 shadow-md transition-all";
        const iEl = deskPemilih.querySelector('i');
        if (iEl) iEl.className = "fas fa-users w-6 text-center text-[#38bdf8]";
    }
    const mobDashboard = document.getElementById('bnav-dashboard');
    const mobPemilih = document.getElementById('bnav-pemilih');
    const mobKandidat = document.getElementById('bnav-kandidat');
    const mobAdmin = document.getElementById('bnav-admin');
    const mobJadwal = document.getElementById('bnav-jadwal');
    const mobPengaturan = document.getElementById('bnav-pengaturan');
    const resetMobileStyle = (el) => {
        if (!el) return;
        el.classList.remove('text-[#38bdf8]');
        el.classList.add('text-[#b5cbdf]');
    };
    resetMobileStyle(mobDashboard);
    resetMobileStyle(mobPemilih);
    resetMobileStyle(mobKandidat);
    resetMobileStyle(mobAdmin);
    resetMobileStyle(mobJadwal);
    resetMobileStyle(mobPengaturan);
    if (mobPemilih) {
        mobPemilih.classList.remove('text-[#b5cbdf]');
        mobPemilih.classList.add('text-[#38bdf8]');
    }
    activeVoterType = (subType === 'pemilih-siswa') ? 'siswa' : ((subType === 'pemilih-guru') ? 'guru' : 'staf');
    voterSearchKeyword = '';
    voterClassFilter = '';
    voterCurrentPage = 1;
    const searchInput = document.getElementById('voterSearchInput');
    if (searchInput) searchInput.value = '';
    const kelasSelect = document.getElementById('voterFilterKelas');
    if (kelasSelect) kelasSelect.dataset.loaded = '0';
    const titleEl = document.querySelector('#view-pemilih h2');
    const descEl = document.querySelector('#view-pemilih p');
    const btnAdd = document.getElementById('btnAddVoter');
    const btnDeleteAll = document.getElementById('btnDeleteAllVoters');
    const idHeader = document.getElementById('voterIdHeader');
    const typeLabel = activeVoterType === 'siswa' ? 'Siswa' : (activeVoterType === 'guru' ? 'Guru' : 'Staf');
    const idLabel = activeVoterType === 'siswa' ? 'NIS' : (activeVoterType === 'guru' ? 'NIP' : 'Kode Staf');
    if (titleEl) titleEl.innerHTML = `<i class="fas fa-users mr-2 text-sky-600"></i>Data ${typeLabel}`;
    if (descEl) descEl.textContent = `Pengelolaan data ${typeLabel.toLowerCase()} yang berhak memberikan suara.`;
    if (btnAdd) {
        btnAdd.title = `Tambah ${typeLabel}`;
        btnAdd.innerHTML = `<i class="fas fa-plus text-xs sm:text-sm"></i> <span class="admin-btn-label">Tambah ${typeLabel}</span>`;
    }
    if (btnDeleteAll) {
        btnDeleteAll.title = `Hapus Semua Data ${typeLabel}`;
    }
    if (idHeader) idHeader.textContent = idLabel;
    syncVoterClassColumn();
    if (activeVoterType === 'siswa') {
        updateHtmlSubmenuActive('nav-pemilih-siswa');
        updateMobileTabActive('mob-tab-siswa');
    } else if (activeVoterType === 'guru') {
        updateHtmlSubmenuActive('nav-pemilih-guru');
        updateMobileTabActive('mob-tab-guru');
    } else if (activeVoterType === 'staf') {
        updateHtmlSubmenuActive('nav-pemilih-staf');
        updateMobileTabActive('mob-tab-staf');
    }
    loadVoterData(true);
    activeAdminView = 'pemilih';
}
function syncVoterClassColumn() {
    const theadRow = document.querySelector('#voterTable thead tr');
    if (!theadRow) return;
    let classHeader = document.getElementById('voterClassHeader');
    if (activeVoterType === 'siswa') {
        if (!classHeader && syncVoterClassColumn._node) {
            const insertBefore = theadRow.children[3] || null;
            theadRow.insertBefore(syncVoterClassColumn._node, insertBefore);
            classHeader = syncVoterClassColumn._node;
        }
        if (classHeader) classHeader.style.display = '';
        return;
    }
    if (classHeader) {
        syncVoterClassColumn._node = classHeader;
        classHeader.remove();
    }
}

function updateHtmlSubmenuActive(activeId) {
    const items = ['nav-pemilih-siswa', 'nav-pemilih-guru', 'nav-pemilih-staf'];
    items.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const span = el.querySelector('span');
        if (id === activeId) {
            el.className = "group flex items-center pl-8 pr-3 py-2 text-xs text-white transition-all";
            el.querySelector('i').className = "fas " + getSubmenuIcon(id) + " w-4 text-center text-[#38bdf8]";
            if (span) span.className = "ml-2 border-b border-[#38bdf8] pb-0.5 transition-colors menu-text";
        } else {
            el.className = "group flex items-center pl-8 pr-3 py-2 text-xs text-[#b5cbdf] hover:text-white transition-all";
            el.querySelector('i').className = "fas " + getSubmenuIcon(id) + " w-4 text-center text-[#9db9d8] group-hover:text-[#38bdf8] transition-colors";
            if (span) span.className = "ml-2 border-b border-transparent group-hover:border-[#38bdf8] pb-0.5 transition-colors menu-text";
        }
    });
}
function updateMobileTabActive(activeId) {
    const tabs = ['mob-tab-siswa', 'mob-tab-guru', 'mob-tab-staf'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === activeId) {
            el.className = "flex-1 py-3 text-[11px] sm:text-xs font-bold text-center border-b-2 border-[#38bdf8] text-[#38bdf8] transition-colors bg-white";
        } else {
            el.className = "flex-1 py-3 text-[11px] sm:text-xs font-bold text-center border-b-2 border-transparent text-gray-500 hover:text-gray-700 transition-colors bg-white hover:bg-gray-50";
        }
    });
}
function getSubmenuIcon(id) {
    if (id === 'nav-pemilih-siswa') return 'fa-user-graduate';
    if (id === 'nav-pemilih-guru') return 'fa-chalkboard-teacher';
    return 'fa-user-cog';
}

function ensureAdminSurfaceVisible() {
    const views = document.querySelectorAll('.view-content');
    if (!views.length) return;
    const anyVisible = Array.from(views).some((view) => !view.classList.contains('hidden'));
    if (anyVisible) return;
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard) return;
    dashboard.classList.remove('hidden');
    dashboard.classList.add('block');
    activeAdminView = 'dashboard';
}

window.addEventListener('pageshow', ensureAdminSurfaceVisible);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureAdminSurfaceVisible();
});
document.addEventListener('DOMContentLoaded', ensureAdminSurfaceVisible);
