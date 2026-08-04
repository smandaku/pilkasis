function isFullscreenActive() {
    return !!(document.fullscreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
        || document.mozFullScreenElement);
}

function formatJadwalWaktuId(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function fetchJadwalPemilihan() {
    const { data, error } = await db
        .from('pengaturan')
        .select('mode,active,mulai,selesai')
        .eq('id', 'jadwal_pemilihan')
        .maybeSingle();
    if (error) return null;
    return data || null;
}

function evaluateJadwalAccess(data) {
    if (!data) {
        return { open: false, message: 'Jadwal pemilihan belum dibuka.' };
    }

    if (data.mode === 'manual') {
        const open = data.active === true || data.active === 1;
        return {
            open,
            message: open
                ? ''
                : 'Akses pemilihan ditutup oleh panitia (mode manual).'
        };
    }

    if (data.mode === 'auto') {
        if (!data.mulai || !data.selesai) {
            return { open: false, message: 'Jadwal otomatis belum diatur oleh panitia.' };
        }
        const now = Date.now();
        const start = new Date(data.mulai).getTime();
        const end = new Date(data.selesai).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) {
            return { open: false, message: 'Jadwal otomatis tidak valid. Hubungi panitia untuk mengatur ulang waktu.' };
        }
        if (now < start) {
            const mulaiLabel = formatJadwalWaktuId(data.mulai);
            return {
                open: false,
                message: mulaiLabel
                    ? `Pemilihan belum dimulai. Jadwal otomatis dibuka pada ${mulaiLabel}.`
                    : 'Pemilihan belum dimulai (jadwal otomatis belum dibuka).'
            };
        }
        if (now > end) {
            const selesaiLabel = formatJadwalWaktuId(data.selesai);
            return {
                open: false,
                message: selesaiLabel
                    ? `Pemilihan sudah ditutup. Jadwal otomatis berakhir pada ${selesaiLabel}.`
                    : 'Pemilihan sudah ditutup (jadwal otomatis telah berakhir).'
            };
        }
        return { open: true, message: '' };
    }

    return { open: false, message: 'Jadwal pemilihan belum mulai atau sudah ditutup.' };
}

async function resolveJadwalGateMessage(fallbackMessage) {
    const access = evaluateJadwalAccess(await fetchJadwalPemilihan());
    if (!access.open) {
        return access.message || fallbackMessage || 'Jadwal pemilihan belum mulai atau sudah ditutup.';
    }

    const raw = String(fallbackMessage || '');
    if (/operator does not exist|timestamp with time zone|22P02|sesi gagal/i.test(raw)) {
        return 'Gagal memulai pemilihan. Mencoba jalur cadangan...';
    }
    return raw || 'Gagal memulai pemilihan. Coba lagi.';
}

function isJadwalRelatedError(message) {
    const msg = String(message || '');
    return /jadwal|ditutup|belum mulai|belum dibuka|operator does not exist|timestamp with time zone|sesi gagal/i.test(msg);
}

function shouldTryVotingSessionFallback(message) {
    const msg = String(message || '');
    return isJadwalRelatedError(msg)
        || /22P02|PGRST|Failed to fetch|NetworkError|jadwal pemilihan belum mulai atau sudah ditutup/i.test(msg);
}

async function beginVotingSessionFallback(inputUser, inputPass) {
    const access = evaluateJadwalAccess(await fetchJadwalPemilihan());
    if (!access.open) {
        return { success: false, error: access.message || 'Jadwal pemilihan belum mulai atau sudah ditutup.' };
    }

    const { data: loginRes, error: loginErr } = await db.rpc('login_pemilih', {
        p_id: inputUser,
        p_password: inputPass
    });
    if (loginErr || !loginRes || !loginRes.success) {
        return {
            success: false,
            error: (loginRes && loginRes.error) || (loginErr && loginErr.message) || 'ID atau Password salah!'
        };
    }

    if (Number(loginRes.sudah_memilih) === 1 || loginRes.sudah_memilih === true) {
        return { success: false, error: 'Anda sudah memberikan suara' };
    }

    const { data: cands, error: candErr } = await db
        .from('kandidat')
        .select('id,nomor_urut,nama,kelas,posisi,visi,misi,foto')
        .order('posisi', { ascending: true })
        .order('nomor_urut', { ascending: true });

    if (candErr) {
        return { success: false, error: candErr.message || 'Gagal memuat data kandidat.' };
    }

    const candidates = normalizeCandidatesList(cands);
    if (!candidates.length) {
        return { success: false, error: 'Belum ada kandidat yang terdaftar' };
    }

    return {
        success: true,
        voter_type: loginRes.voter_type,
        id: loginRes.id,
        nama: loginRes.nama,
        kelas: loginRes.kelas || '',
        candidates,
        candidates_cached: false,
        candidates_version: null,
        session_token: null
    };
}

function applyCurrentVoterFromSession(sessionResult, inputUser) {
    window.currentVoter = {
        id: sessionResult.id || inputUser,
        type: sessionResult.voter_type,
        name: sessionResult.nama || inputUser,
        kelas: sessionResult.kelas || '',
        sessionToken: sessionResult.session_token || ''
    };
}

async function issueVotingSessionToken(inputUser, inputPass) {
    const { data, error } = await db.rpc('issue_voting_session_token', {
        p_id: inputUser,
        p_password: inputPass
    });
    if (error || !data || !data.success || !data.session_token) {
        return {
            success: false,
            error: (data && data.error) || (error && error.message) || 'Gagal membuat sesi voting.',
            capacity_full: !!(data && data.capacity_full),
            active_count: data && data.active_count,
            max_limit: data && data.max_limit
        };
    }
    return { success: true, session_token: data.session_token };
}

async function issueVotingSessionTokenUntilReady(inputUser, inputPass) {
    const startedAt = Date.now();
    const maxWaitMs = getVotingWaitTimeoutMs();
    while (true) {
        const tokenRes = await issueVotingSessionToken(inputUser, inputPass);
        if (tokenRes.success) return tokenRes;
        if (!tokenRes.capacity_full && !/bilik suara penuh/i.test(String(tokenRes.error || ''))) {
            return tokenRes;
        }
        if (Date.now() - startedAt >= maxWaitMs) {
            return { success: false, error: 'Bilik suara masih penuh. Silakan coba lagi sesaat atau hubungi panitia.' };
        }
        const activeCount = tokenRes.active_count != null ? tokenRes.active_count : '?';
        const maxLimit = tokenRes.max_limit != null ? tokenRes.max_limit : '?';
        setLoginStatus(`Bilik suara penuh (${activeCount}/${maxLimit}). Menunggu slot kosong...`, true);
        UI.btnTxt.textContent = 'Menunggu slot...';
        await sleepMs(CAPACITY_WAIT_INTERVAL_MS + jitterMs(0, 1200));
    }
}

async function ensureSessionResultHasToken(sessionResult, inputUser, inputPass) {
    if (!sessionResult || !sessionResult.success) return sessionResult;
    if (sessionResult.session_token) return sessionResult;

    const tokenRes = await issueVotingSessionTokenUntilReady(inputUser, inputPass);
    if (!tokenRes.success) {
        return { success: false, error: tokenRes.error || 'Gagal membuat sesi voting.' };
    }
    return { ...sessionResult, session_token: tokenRes.session_token };
}

function applyImmersiveFallback() {
    document.documentElement.classList.add('pilkasis-immersive');
    document.body.classList.add('pilkasis-immersive');
}

function clearImmersiveFallback() {
    document.documentElement.classList.remove('pilkasis-immersive', 'pilkasis-mobile-fs');
    document.body.classList.remove('pilkasis-immersive', 'pilkasis-mobile-fs');
}

function isMobileVotingDevice() {
    if (typeof isMobilePortraitView === 'function' && isMobilePortraitView()) return true;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function isIOSDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function supportsDocumentFullscreen() {
    const root = document.documentElement;
    const body = document.body;
    return !!(getFullscreenRequestFn(root) || getFullscreenRequestFn(body));
}

function forceMobileImmersiveViewport() {
    applyImmersiveFallback();
    document.documentElement.classList.add('pilkasis-mobile-fs');
    document.body.classList.add('pilkasis-mobile-fs');
    const voterView = document.getElementById('voterView');
    if (voterView && !voterView.classList.contains('hidden')) {
        void voterView.offsetHeight;
        voterView.style.transform = 'translateZ(0)';
        requestAnimationFrame(() => {
            try { voterView.style.transform = ''; } catch (e) { }
        });
    }
    try {
        window.scrollTo(0, 0);
    } catch (e) { }
}

function getFullscreenRequestFn(el) {
    if (!el) return null;
    return el.requestFullscreen
        || el.webkitRequestFullscreen
        || el.webkitRequestFullScreen
        || el.msRequestFullscreen
        || el.mozRequestFullScreen
        || null;
}

function callFullscreenRequest(el, req) {
    if (!el || !req) return null;
    if (req === el.requestFullscreen) {
        return req.call(el, { navigationUI: 'hide' });
    }
    return req.call(el);
}

function prepareFullscreenTarget(el) {
    if (el && el.id === 'voterView') {
        el.classList.remove('hidden');
        void el.offsetHeight;
    }
}

function kickoffNativeFullscreenFromGesture() {
    if (!supportsDocumentFullscreen()) {
        forceMobileImmersiveViewport();
        return Promise.resolve();
    }

    let pending = null;
    const targets = [];
    const voterView = document.getElementById('voterView');
    if (voterView && !voterView.classList.contains('hidden')) {
        targets.push(voterView);
    }
    targets.push(document.documentElement, document.body);
    for (const el of targets) {
        if (isFullscreenActive()) break;
        prepareFullscreenTarget(el);
        const req = getFullscreenRequestFn(el);
        if (!req) continue;
        try {
            const maybePromise = callFullscreenRequest(el, req);
            if (maybePromise && typeof maybePromise.then === 'function') {
                pending = maybePromise.catch(() => { });
            }
            break;
        } catch (err) {
            console.warn('Fullscreen ditolak/tidak didukung:', err);
        }
    }
    if (!pending) forceMobileImmersiveViewport();
    return pending || Promise.resolve();
}

let suppressVotingSessionReleaseUntil = 0;
let boothEntryTransition = false;

function holdVotingSessionRelease(ms = 8000) {
    suppressVotingSessionReleaseUntil = Date.now() + Math.max(0, Number(ms) || 0);
}

function isVoterSurfaceReady(voterView, wizard) {
    if (!voterView || voterView.classList.contains('hidden')) return false;
    let height = Math.max(voterView.clientHeight || 0, voterView.offsetHeight || 0);
    if (height <= 50) {
        height = Math.max(
            height,
            window.visualViewport?.height || 0,
            document.documentElement?.clientHeight || 0,
            window.innerHeight || 0
        );
    }
    const hasWizardContent = !!(wizard && wizard.childElementCount > 0);
    return height > 50 && hasWizardContent;
}

async function beginVotingBoothFromGesture(offlineBundle) {
    holdVotingSessionRelease(getVotingSessionHoldMs());
    clearLoginReadyModalGuard();
    if (typeof window.clearPilkasisLoginNudge === 'function') {
        window.clearPilkasisLoginNudge({ silent: true });
    }

    try {
        await startVotingWizard(offlineBundle, { requestFullscreenSync: true });

        if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
        forceMobileImmersiveViewport();
        await recoverBlankVoterSurfaceIfNeeded();

        const voterView = document.getElementById('voterView');
        const wizard = document.getElementById('wizardContent');
        if (!isVoterSurfaceReady(voterView, wizard)) {
            if (voterConfigPositions.length > 0) {
                renderWizardStep();
                if (typeof scheduleWizardFitTexts === 'function') scheduleWizardFitTexts();
                forceMobileImmersiveViewport();
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
            if (!isVoterSurfaceReady(voterView, wizard)) {
                throw new Error('Gagal menampilkan bilik suara. Silakan ketuk Masuk dan coba lagi.');
            }
        }

        if (isMobileVotingDevice()) {
            try {
                window.scrollTo(0, 0);
                if (isIOSDevice()) {
                    window.scrollTo(0, 1);
                    setTimeout(() => { try { window.scrollTo(0, 0); } catch (e) { } }, 50);
                }
            } catch (e) { }
        }

        armVotingBackGuard();
    } finally {
        if (isVoterViewVisible()) hideLoginView();
        ensureAppSurfaceVisible();
    }
}

async function recoverBlankVoterSurfaceIfNeeded() {
    const voterView = document.getElementById('voterView');
    const wizard = document.getElementById('wizardContent');
    if (!voterView || voterView.classList.contains('hidden')) return;

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const hasWizardContent = !!(wizard && wizard.childElementCount > 0);
    if (isVoterSurfaceReady(voterView, wizard)) return;

    if (!hasWizardContent && voterConfigPositions.length > 0) {
        renderWizardStep();
        if (typeof scheduleWizardFitTexts === 'function') scheduleWizardFitTexts();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (isVoterSurfaceReady(voterView, wizard)) return;
    }

    forceMobileImmersiveViewport();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (isVoterSurfaceReady(voterView, wizard)) return;

    if (isFullscreenActive()) {
        console.warn('Bilik kosong setelah fullscreen — beralih ke mode immersive CSS.');
        const exit = document.exitFullscreen
            || document.webkitExitFullscreen
            || document.webkitCancelFullScreen
            || document.msExitFullscreen
            || document.mozCancelFullScreen;
        if (exit) {
            try { await Promise.resolve(exit.call(document)); } catch (e) { }
        }
    }
    forceMobileImmersiveViewport();
}

function showVoterView() {
    const voterView = document.getElementById('voterView');
    if (voterView) {
        voterView.classList.remove('hidden');
        void voterView.offsetHeight;
    }
}

function hideLoginView() {
    if (UI.viewLogin) UI.viewLogin.classList.add('hidden');
}

function exitAppFullscreen() {
    clearImmersiveFallback();
    if (!isFullscreenActive()) return;
    const exit = document.exitFullscreen
        || document.webkitExitFullscreen
        || document.webkitCancelFullScreen
        || document.msExitFullscreen
        || document.mozCancelFullScreen;
    if (!exit) return;
    Promise.resolve(exit.call(document)).catch(() => { });
}

let loginModalArmed = false;
let loginAwaitingConfirm = false;

function armLoginReadyModalGuard() {
    if (loginModalArmed && history.state && history.state.pilkasisLoginModal) return;
    try {
        history.pushState({ pilkasisLoginModal: true }, '');
        loginModalArmed = true;
    } catch (e) {
        loginModalArmed = false;
    }
}

function clearLoginReadyModalGuard() {
    if (!loginModalArmed) return;
    loginModalArmed = false;
    if (!(history.state && history.state.pilkasisLoginModal)) return;
    try {
        history.replaceState(null, '', window.location.href);
    } catch (e) { }
}

function lockLoginFormForConfirm() {
    loginAwaitingConfirm = true;
    if (UI.userInput) UI.userInput.disabled = true;
    if (UI.passInput) UI.passInput.disabled = true;
    if (UI.btnSub) {
        UI.btnSub.disabled = true;
        UI.btnSub.classList.add('opacity-80', 'cursor-not-allowed');
    }
    if (UI.spin) UI.spin.classList.add('hidden');
    if (UI.btnIco) UI.btnIco.classList.add('hidden');
    if (UI.btnTxt) UI.btnTxt.textContent = 'Menunggu konfirmasi...';
}

async function releaseVotingSessionToken(token) {
    if (!token) return;
    try {
        await db.rpc('release_voting_session', { p_session_token: token });
    } catch (e) {
        console.warn('Gagal melepaskan sesi voting:', e);
    }
}

function takeCurrentSessionToken() {
    const token = window.currentVoter?.sessionToken || '';
    if (window.currentVoter) window.currentVoter.sessionToken = '';
    return token;
}

async function clearCurrentVoterAndRelease(extraToken) {
    const token = extraToken || takeCurrentSessionToken();
    window.currentVoter = null;
    await releaseVotingSessionToken(token);
}

function unlockLoginForm() {
    loginAwaitingConfirm = false;
    if (UI.userInput) UI.userInput.disabled = false;
    if (UI.passInput) UI.passInput.disabled = false;
    if (typeof resetBtn === 'function') resetBtn();
}

async function dismissLoginReadyModalFromBack() {
    loginModalArmed = false;
    if (typeof window.closeVoterModal === 'function') {
        window.closeVoterModal();
    } else if (UI.mod) {
        UI.mod.classList.remove('active');
        const panel = document.getElementById('customModalPanel');
        if (panel) panel.classList.remove('modal-booth-entry');
    }
    const sessionToken = takeCurrentSessionToken();
    revokeVotingObjectUrls();
    window.currentVoter = null;
    await releaseVotingSessionToken(sessionToken);
    unlockLoginForm();
    if (UI.loginStatus) {
        setLoginStatus('Konfirmasi dibatalkan. Ketuk Masuk untuk mencoba lagi.', false);
    }
}

window.addEventListener('popstate', () => {
    if (boothEntryTransition || loginAwaitingConfirm) return;
    if (!loginModalArmed) return;
    const loginVisible = UI.viewLogin && !UI.viewLogin.classList.contains('hidden');
    const modalOpen = UI.mod && UI.mod.classList.contains('active');
    if (!loginVisible || !modalOpen) {
        loginModalArmed = false;
        return;
    }
    if (Date.now() < suppressVotingSessionReleaseUntil) return;
    dismissLoginReadyModalFromBack();
});

function releaseVotingSessionKeepalive(token) {
    if (!token) return;
    try {
        fetch(`${SUPABASE_URL}/rest/v1/rpc/release_voting_session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ p_session_token: token }),
            keepalive: true
        });
    } catch (e) {
        console.warn('Gagal melepaskan sesi voting (keepalive):', e);
    }
}

window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    if (Date.now() < suppressVotingSessionReleaseUntil) return;
    if (loginAwaitingConfirm || boothEntryTransition || isVotingBoothActive()) return;
    if (!isVoterViewVisible()) return;
    const token = window.currentVoter?.sessionToken || '';
    if (!token) return;
    if (window.currentVoter) window.currentVoter.sessionToken = '';
    releaseVotingSessionKeepalive(token);
});

function looksLikeAdminUsername(id) {
    const s = String(id || '').trim();
    if (!s) return false;

    if (/^\d+$/.test(s)) return false;
    return /^[a-zA-Z][a-zA-Z0-9._@-]{0,47}$/.test(s);
}

const VOTING_CANDIDATES_CACHE_KEY = 'pilkasis_cand_bundle_v1';
const VOTING_CANDIDATES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function getCachedVotingCandidates() {
    try {
        const raw = localStorage.getItem(VOTING_CANDIDATES_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.version || !Array.isArray(parsed.candidates) || !parsed.candidates.length) return null;
        if (parsed.ts && (Date.now() - Number(parsed.ts) > VOTING_CANDIDATES_CACHE_TTL_MS)) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function setCachedVotingCandidates(version, candidates) {
    if (!version || !Array.isArray(candidates) || !candidates.length) return;
    try {
        localStorage.setItem(VOTING_CANDIDATES_CACHE_KEY, JSON.stringify({
            version: String(version),
            candidates,
            ts: Date.now()
        }));
    } catch (e) {

    }
}

UI.form.onsubmit = async (e) => {
    e.preventDefault();
    if (loginAwaitingConfirm) return;
    if (UI.mod && UI.mod.classList.contains('active')) return;

    loginAwaitingConfirm = true;
    if (UI.userInput) UI.userInput.disabled = true;
    if (UI.passInput) UI.passInput.disabled = true;

    if (typeof window.clearPilkasisLoginNudge === 'function') {
        window.clearPilkasisLoginNudge();
    }
    UI.loginStatus.classList.add('hidden');
    UI.btnSub.disabled = true;
    UI.btnSub.classList.add('opacity-80', 'cursor-not-allowed');
    UI.btnTxt.textContent = "Mengautentikasi...";
    UI.btnIco.classList.add('hidden');
    UI.spin.classList.remove('hidden');
    try {
        const inputUser = UI.userInput.value.trim();
        const inputPass = UI.passInput.value.trim();

        if (!inputUser || !inputPass) {
            setLoginStatus('ID dan Password wajib diisi.', false);
            unlockLoginForm();
            return;
        }

        if (looksLikeAdminUsername(inputUser)) {
            const { data: adminResult, error: adminErr } = await db.rpc('login_admin', {
                p_username: inputUser,
                p_password: inputPass
            });

            if (adminErr) {
                setLoginStatus('Gagal menghubungkan ke database. Pastikan koneksi internet aktif dan database telah di-setup.', false);
                unlockLoginForm();
                return;
            }

            if (adminResult) {
                if (adminResult.success) {
                    if (!adminResult.session_token) {
                        setLoginStatus('Login admin gagal: skema sesi belum di-update. Jalankan schema.sql terbaru.', false);
                        unlockLoginForm();
                        return;
                    }
                    setLoginStatus("Login Admin berhasil! Mengalihkan ke dashboard...", true);
                    UI.btnTxt.textContent = "Mengalihkan...";
                    setAdminSession(adminResult.username, adminResult.session_token);
                    setTimeout(() => {
                        window.location.href = 'admin.html';
                        return;
                    }, 1000);
                    return;
                } else if (adminResult.code === 'WRONG_PASSWORD') {
                    setLoginStatus('Password admin salah!', false);
                    unlockLoginForm();
                    return;
                }
            }
        }

        {
            const candCache = getCachedVotingCandidates();
            await waitForLoginQueueSlot(inputUser, !!(candCache && candCache.version));

            setLoginStatus("Mengunduh data pemilihan...", true);
            UI.btnTxt.textContent = "Mengunduh data...";
            await sleepMs(jitterMs(80, 220));

            const rpcArgs = {
                p_id: inputUser,
                p_password: inputPass
            };
            if (candCache && candCache.version) {
                rpcArgs.p_cand_version = candCache.version;
            }

            let sessionResult = null;
            let sessionErr = null;
            ({ data: sessionResult, error: sessionErr } = await beginVotingSessionUntilReady(rpcArgs));

            if (sessionErr && /p_cand_version|Could not find the function|PGRST202|404/i.test(String(sessionErr.message || ''))) {
                ({ data: sessionResult, error: sessionErr } = await beginVotingSessionUntilReady({
                    p_id: inputUser,
                    p_password: inputPass
                }));
            }

            if (sessionErr || !sessionResult || !sessionResult.success) {
                const rawMsg = sessionResult?.error || sessionErr?.message || 'ID atau Password salah!';

                if (shouldTryVotingSessionFallback(rawMsg)) {
                    setLoginStatus('Menyiapkan data pemilihan...', true);
                    const fallback = await beginVotingSessionFallback(inputUser, inputPass);
                    if (fallback && fallback.success) {
                        sessionResult = fallback;
                        sessionErr = null;
                    } else {
                        const fbMsg = fallback?.error || rawMsg;
                        const loginMsg = isJadwalRelatedError(fbMsg)
                            ? await resolveJadwalGateMessage(fbMsg)
                            : fbMsg;
                        setLoginStatus(loginMsg, false);
                        unlockLoginForm();
                        return;
                    }
                } else {
                    setLoginStatus(rawMsg, false);
                    unlockLoginForm();
                    return;
                }
            }

            let candidates = normalizeCandidatesList(sessionResult.candidates);
            if (sessionResult.candidates_cached) {
                if (candCache && Array.isArray(candCache.candidates) && candCache.candidates.length) {
                    candidates = normalizeCandidatesList(candCache.candidates);
                } else {
                    const staleToken = sessionResult.session_token || '';
                    setLoginStatus('Mengambil ulang data kandidat...', true);
                    const { data: fullSession, error: fullErr } = await beginVotingSessionUntilReady({
                        p_id: inputUser,
                        p_password: inputPass,
                        p_cand_version: null
                    });
                    if (fullErr || !fullSession || !fullSession.success) {
                        const rawMsg = fullSession?.error || fullErr?.message || 'Gagal memuat data kandidat.';
                        const fallback = await beginVotingSessionFallback(inputUser, inputPass);
                        if (fallback && fallback.success && Array.isArray(fallback.candidates) && fallback.candidates.length) {
                            sessionResult = { ...fallback, session_token: sessionResult.session_token || null };
                            candidates = normalizeCandidatesList(fallback.candidates);
                        } else {
                            await releaseVotingSessionToken(staleToken);
                            const fbMsg = fallback?.error || rawMsg;
                            const loginMsg = isJadwalRelatedError(fbMsg)
                                ? await resolveJadwalGateMessage(fbMsg)
                                : fbMsg;
                            setLoginStatus(loginMsg, false);
                            unlockLoginForm();
                            return;
                        }
                    } else {
                        const nextToken = fullSession.session_token || sessionResult.session_token;
                        if (staleToken && nextToken && staleToken !== nextToken) {
                            await releaseVotingSessionToken(staleToken);
                        }
                        sessionResult = {
                            ...sessionResult,
                            session_token: nextToken,
                            candidates_version: fullSession.candidates_version
                        };
                        candidates = normalizeCandidatesList(fullSession.candidates);
                        if (fullSession.candidates_version) {
                            setCachedVotingCandidates(fullSession.candidates_version, candidates);
                        }
                    }
                }
            } else if (sessionResult.candidates_version && candidates.length) {
                setCachedVotingCandidates(sessionResult.candidates_version, candidates);
            }

            sessionResult = await ensureSessionResultHasToken(sessionResult, inputUser, inputPass);
            if (!sessionResult || !sessionResult.success || !sessionResult.session_token) {
                setLoginStatus(sessionResult?.error || 'Gagal membuat sesi voting. Silakan login ulang.', false);
                unlockLoginForm();
                return;
            }

            applyCurrentVoterFromSession(sessionResult, inputUser);
            holdVotingSessionRelease(180000);

            if (!candidates.length) {
                setLoginStatus('Login berhasil, tetapi data kandidat kosong. Hubungi panitia.', false);
                await clearCurrentVoterAndRelease();
                unlockLoginForm();
                return;
            }

            setLoginStatus(`Menyiapkan ${candidates.length} data kandidat...`, true);
            UI.btnTxt.textContent = "Mengunduh data...";

            const offlineBundle = await downloadVotingBundleOffline(candidates, (progressMsg) => {
                setLoginStatus(progressMsg, true);
                UI.btnTxt.textContent = "Mengunduh data...";
            });
            if (!offlineBundle || !offlineBundle.candidates.length || !offlineBundle.positions.length) {
                setLoginStatus('Gagal menyiapkan data pemilihan. Periksa koneksi lalu coba lagi.', false);
                revokeVotingObjectUrls();
                await clearCurrentVoterAndRelease();
                holdVotingSessionRelease(0);
                unlockLoginForm();
                return;
            }

            holdVotingSessionRelease(30 * 60 * 1000);
            setLoginStatus("Data siap. Pemilihan berjalan offline hingga pengiriman suara.", true);
            lockLoginFormForConfirm();
            armLoginReadyModalGuard();

            showModal(
                "Masuk Bilik Suara",
                "Selamat datang, <b>" + escapeHtmlAttr(window.currentVoter.name) + "</b>." +
                "<br><br><b>Cara memilih:</b>" +
                "<ol class=\"voter-booth-instructions list-decimal pl-5 mt-2 space-y-1 text-left\">" +
                "<li>Pilih satu kandidat pada setiap posisi dengan menekan Foto-nya.</li>" +
                "<li>Tekan <b>Lihat Visi &amp; Misi</b> jika ingin membaca visi dan misi kandidat.</li>" +
                "<li>Tekan <b>Lanjut</b> untuk posisi berikutnya, atau <b>Kembali</b> jika ingin mengubah pilihan.</li>" +
                "<li>Di halaman ringkasan, periksa pilihan Anda lalu tekan <b>Kirim Suara</b>.</li>" +
                "<li>Pastikan perangkat terhubung internet saat mengirim suara.</li>" +
                "</ol>",
                false,
                "Mulai Memilih",
                async () => {
                    const voterView = document.getElementById('voterView');
                    try {
                        await beginVotingBoothFromGesture(offlineBundle);
                    } catch (wizardErr) {
                        console.error('Gagal memulai bilik suara:', wizardErr);
                        clearVotingBackGuard();
                        if (voterView) voterView.classList.add('hidden');
                        if (UI.viewLogin) UI.viewLogin.classList.remove('hidden');
                        clearImmersiveFallback();
                        exitAppFullscreen();
                        revokeVotingObjectUrls();
                        await clearCurrentVoterAndRelease();
                        unlockLoginForm();
                        setLoginStatus(wizardErr?.message || 'Gagal memuat bilik suara. Silakan login ulang.', false);
                        alert(wizardErr?.message || 'Gagal memuat bilik suara. Silakan login ulang.');
                    }
                },
                { boothEntry: true }
            );
        }
    } catch (err) {
        setLoginStatus("Database Error: " + err.message, false);
        console.error("Login Error:", err);
        revokeVotingObjectUrls();
        await clearCurrentVoterAndRelease();
        unlockLoginForm();
    }
};

let voterConfigPositions = [];
let voterAllCandidates = [];
let voterCandidateImageMap = {};
let voterCurrentStep = 0;
let voterDraftSelections = {};
let voterOfflineLogoSrc = '';
let voterObjectUrls = [];
let votingBoothTimerId = null;
let votingBoothDeadlineMs = 0;
let votingBoothExpired = false;
let votingBoothTimedOutDuringSubmit = false;

const CANDIDATE_PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">' +
    '<rect fill="#1e293b" width="300" height="400"/>' +
    '<text x="150" y="205" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-size="22">No Photo</text>' +
    '</svg>'
);

function revokeVotingObjectUrls() {
    voterObjectUrls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (e) { }
    });
    voterObjectUrls = [];
}

function trackObjectUrl(url) {
    if (url && String(url).startsWith('blob:')) voterObjectUrls.push(url);
    return url;
}

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function jitterMs(minMs, maxMs) {
    const lo = Math.max(0, Number(minMs) || 0);
    const hi = Math.max(lo, Number(maxMs) || lo);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function getVotingBoothDurationMs() {
    const minutes = Math.max(1, Math.min(60, Number(AppStorage.get(VOTING_BOOTH_DURATION_KEY)) || 5));
    return minutes * 60 * 1000;
}

function getVotingSessionHoldMs() {
    return getVotingBoothDurationMs() + (2 * 60 * 1000);
}

function isVotingBoothActive() {
    return !!(votingBoothTimerId && votingBoothDeadlineMs && !votingBoothExpired && Date.now() < votingBoothDeadlineMs);
}

function getVotingWaitTimeoutMs() {
    const minutes = Math.max(1, Math.min(60, Number(AppStorage.get(VOTING_WAIT_TIMEOUT_KEY)) || 15));
    return minutes * 60 * 1000;
}

function formatCountdownLabel(totalMs) {
    const totalSeconds = Math.max(0, Math.ceil(totalMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildVotingCountdownInfoText(remainingMs) {
    if (remainingMs <= 60 * 1000) {
        return 'Segera selesaikan pilihan dan kirim suara! Waktu hampir habis.';
    }
    return 'Selesaikan semua pilihan sebelum waktu habis, lalu kirim suara Anda.';
}

function updateVotingCountdownDisplay(remainingMs) {
    const timeLabel = formatCountdownLabel(remainingMs);
    const urgent = remainingMs <= 60 * 1000;

    const mobileTime = document.getElementById('votingCountdown');
    const desktopTime = document.getElementById('votingCountdownDesktopTime');
    [mobileTime, desktopTime].forEach((el) => {
        if (!el) return;
        el.textContent = timeLabel;
        el.classList.remove('text-amber-300', 'text-rose-400');
        el.classList.add(urgent ? 'text-rose-400' : 'text-amber-300');
    });

    const infoText = buildVotingCountdownInfoText(remainingMs);
    document.querySelectorAll('.voting-countdown-marquee-text').forEach((span) => {
        span.textContent = infoText;
        span.classList.toggle('voting-countdown-marquee-text--urgent', urgent);
    });
}

function stopVotingBoothTimer() {
    if (votingBoothTimerId) {
        clearInterval(votingBoothTimerId);
        votingBoothTimerId = null;
    }
}

function resetVotingBoothTimerState() {
    stopVotingBoothTimer();
    votingBoothDeadlineMs = 0;
    votingBoothExpired = false;
    votingBoothTimedOutDuringSubmit = false;
}

async function handleVotingBoothTimeout() {
    if (votingBoothExpired) return;
    if (voteSubmitting) {
        votingBoothTimedOutDuringSubmit = true;
        stopVotingBoothTimer();
        updateVotingCountdownDisplay(0);
        return;
    }
    votingBoothExpired = true;
    stopVotingBoothTimer();

    const visiMisiModal = document.getElementById('visiMisiModal');
    if (visiMisiModal) {
        visiMisiModal.classList.remove('active');
    }

    const timeoutHtml = `
        <div class="text-center py-2 space-y-3">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 mb-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <p class="text-slate-200 text-sm font-medium">Waktu memilih di bilik suara telah habis.</p>
            <p class="text-xs text-slate-400">Silakan login ulang untuk memulai pemilihan dari awal.</p>
        </div>
    `;

    showModal(
        'Waktu Habis!',
        timeoutHtml,
        false,
        'Login Ulang',
        () => {
            logoutVoter();
        }
    );
}

function resumeVotingBoothTimer() {
    stopVotingBoothTimer();
    if (votingBoothExpired || !votingBoothDeadlineMs) return;
    const remainingMs = votingBoothDeadlineMs - Date.now();
    updateVotingCountdownDisplay(remainingMs);
    if (remainingMs <= 0) {
        handleVotingBoothTimeout().catch((err) => {
            console.error('Gagal menangani timeout bilik suara:', err);
        });
        return;
    }
    votingBoothTimerId = setInterval(() => {
        const leftMs = votingBoothDeadlineMs - Date.now();
        updateVotingCountdownDisplay(leftMs);
        if (leftMs <= 0) {
            handleVotingBoothTimeout().catch((err) => {
                console.error('Gagal menangani timeout bilik suara:', err);
            });
        }
    }, 250);
}

function startVotingBoothTimer() {
    stopVotingBoothTimer();
    votingBoothExpired = false;
    votingBoothTimedOutDuringSubmit = false;
    votingBoothDeadlineMs = Date.now() + getVotingBoothDurationMs();
    holdVotingSessionRelease(getVotingSessionHoldMs());
    resumeVotingBoothTimer();
}

const LOGIN_QUEUE_PROFILES = {
    free: {
        bucketsCold: 30,
        bucketsWarm: 15,
        bucketMs: 2000,
        extraJitterMs: 400
    },
    pro: {
        bucketsCold: 12,
        bucketsWarm: 6,
        bucketMs: 1000,
        extraJitterMs: 300
    }
};

function getLoginQueueProfile() {
    try {
        const urlProfile = new URLSearchParams(window.location.search).get('queue');
        if (urlProfile === 'free' || urlProfile === 'pro') return urlProfile;
    } catch (e) { }

    try {
        const stored = localStorage.getItem(LOGIN_QUEUE_PROFILE_KEY);
        if (stored === 'free' || stored === 'pro') return stored;
    } catch (e) { }

    return 'free';
}

function getLoginQueueConfig() {
    const profile = getLoginQueueProfile();
    return LOGIN_QUEUE_PROFILES[profile] || LOGIN_QUEUE_PROFILES.free;
}

function isRetryableSessionError(message) {
    const msg = String(message || '').toLowerCase();
    return /failed to fetch|networkerror|network request failed|timeout|timed out|503|502|504|429|too many|connection|pgrst|fetch/i.test(msg);
}

function isCapacityFullSessionResult(data) {
    if (!data || data.success) return false;
    return !!(data.capacity_full || /bilik suara penuh/i.test(String(data.error || '')));
}

const CAPACITY_WAIT_INTERVAL_MS = 2500;

async function callBeginVotingSessionRpc(rpcArgs) {
    const { data, error } = await db.rpc('begin_voting_session', rpcArgs);
    return { data: data || null, error: error || null };
}

async function beginVotingSessionWithRetry(rpcArgs, maxAttempts) {
    const attempts = Math.max(1, Number(maxAttempts) || 3);
    let lastData = null;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const { data, error } = await callBeginVotingSessionRpc(rpcArgs);
        lastData = data;
        lastError = error;

        if (!error && data && data.success) {
            return { data, error: null };
        }

        const bizMsg = data?.error || error?.message || '';
        if (!isRetryableSessionError(bizMsg) || attempt >= attempts) {
            return { data, error };
        }

        const backoff = Math.min(2800, 320 * Math.pow(2, attempt - 1)) + jitterMs(0, 240);
        setLoginStatus(`Server sibuk, mencoba lagi (${attempt}/${attempts})...`, true);
        await sleepMs(backoff);
    }

    return { data: lastData, error: lastError };
}

async function beginVotingSessionUntilReady(rpcArgs, options = {}) {
    const maxWaitMs = options.maxWaitMs || getVotingWaitTimeoutMs();
    const startedAt = Date.now();
    let lastData = null;
    let lastError = null;

    while (true) {
        const { data, error } = await beginVotingSessionWithRetry(rpcArgs, 2);
        lastData = data;
        lastError = error;

        if (data && data.success) {
            return { data, error: null };
        }

        if (!isCapacityFullSessionResult(data)) {
            return { data, error };
        }

        if (Date.now() - startedAt >= maxWaitMs) {
            return {
                data: {
                    success: false,
                    error: 'Bilik suara masih penuh. Silakan coba lagi sesaat atau hubungi panitia.'
                },
                error: null
            };
        }

        const activeCount = data.active_count != null ? data.active_count : '?';
        const maxLimit = data.max_limit != null ? data.max_limit : '?';
        setLoginStatus(`Bilik suara penuh (${activeCount}/${maxLimit}). Menunggu slot kosong...`, true);
        UI.btnTxt.textContent = 'Menunggu slot...';
        await sleepMs(CAPACITY_WAIT_INTERVAL_MS + jitterMs(0, 1200));
    }
}

function hashLoginQueueSeed(value) {
    const text = String(value || '').trim().toUpperCase();
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function computeLoginQueueDelayMs(userId, hasCandidateCache) {
    const config = getLoginQueueConfig();
    const bucketCount = hasCandidateCache ? config.bucketsWarm : config.bucketsCold;
    const slot = hashLoginQueueSeed(userId) % Math.max(1, bucketCount);
    return (slot * config.bucketMs) + jitterMs(0, config.extraJitterMs);
}

async function waitForLoginQueueSlot(userId, hasCandidateCache) {
    const delayMs = computeLoginQueueDelayMs(userId, hasCandidateCache);
    if (delayMs <= 250) return delayMs;

    const startedAt = Date.now();
    UI.btnTxt.textContent = "Menunggu giliran...";

    while (true) {
        const elapsed = Date.now() - startedAt;
        const remaining = delayMs - elapsed;
        if (remaining <= 0) break;

        const remainingSeconds = Math.max(1, Math.ceil(remaining / 1000));
        setLoginStatus(
            hasCandidateCache
                ? `Banyak pemilih sedang masuk. Menunggu giliran login (${remainingSeconds} dtk) agar server tetap stabil.`
                : `Banyak pemilih sedang masuk. Mengatur giliran login (${remainingSeconds} dtk) agar antrean tidak menumpuk.`,
            true
        );
        await sleepMs(Math.min(250, remaining));
    }

    return delayMs;
}

async function runWithConcurrency(items, limit, workerFn) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const results = new Array(list.length);
    let nextIndex = 0;
    const workers = Array.from(
        { length: Math.min(Math.max(1, limit), list.length) },
        async () => {
            while (true) {
                const i = nextIndex++;
                if (i >= list.length) return;
                results[i] = await workerFn(list[i], i);
            }
        }
    );
    await Promise.all(workers);
    return results;
}

function normalizeCandidatesList(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!Array.isArray(data)) return [];
    return data
        .map((c) => {
            if (!c || typeof c !== 'object') return null;
            const posisi = String(c.posisi || '').trim();
            const nama = String(c.nama || '').trim();
            if (!posisi || !nama) return null;
            return {
                ...c,
                id: c.id != null ? String(c.id) : '',
                posisi,
                nama,
                kelas: c.kelas != null ? String(c.kelas) : '',
                foto: c.foto != null ? String(c.foto) : '',
                visi: c.visi != null ? String(c.visi) : '',
                misi: c.misi != null ? String(c.misi) : '',
                nomor_urut: Number(c.nomor_urut) || 0
            };
        })
        .filter(Boolean);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchAssetAsLocalUrl(url, attempt = 1) {
    const cached = getCachedAssetLocalUrl(url);
    if (cached) return cached;
    if (!url) return CANDIDATE_PLACEHOLDER_IMG;
    if (String(url).startsWith('data:')) return url;
    if (String(url).startsWith('blob:')) return url;
    const maxAttempts = 2;
    try {
        const res = await fetchWithTimeout(url, { mode: 'cors', cache: 'force-cache' }, 7000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        if (!blob || blob.size === 0) throw new Error('empty blob');
        return trackObjectUrl(URL.createObjectURL(blob));
    } catch (e) {
        if (attempt < maxAttempts) {
            await sleepMs(80 * attempt + jitterMs(0, 120));
            return fetchAssetAsLocalUrl(url, attempt + 1);
        }

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const el = new Image();
                let settled = false;
                const done = (fn, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    fn(value);
                };
                const timer = setTimeout(() => done(reject, new Error('image timeout')), 5000);
                el.crossOrigin = 'anonymous';
                el.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = el.naturalWidth || el.width || 1;
                        canvas.height = el.naturalHeight || el.height || 1;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(el, 0, 0);
                        done(resolve, canvas.toDataURL('image/jpeg', 0.85));
                    } catch (err) {
                        done(reject, err);
                    }
                };
                el.onerror = () => done(reject, new Error('image error'));
                el.src = url;
            });
            return dataUrl;
        } catch (err) {
            return CANDIDATE_PLACEHOLDER_IMG;
        }
    }
}

function resolveCandidatePhotoUrl(fotoRef) {
    return resolveLocalAssetUrl(fotoRef, CANDIDATE_PLACEHOLDER_IMG);
}

function buildVoterConfigPositions(candidates) {
    const posisiSet = new Map();
    (candidates || []).forEach(c => {
        if (c.posisi && !posisiSet.has(c.posisi)) {
            posisiSet.set(c.posisi, { id: c.posisi, nama_posisi: c.posisi, urutan: posisiSet.size });
        }
    });
    return Array.from(posisiSet.values()).sort((a, b) => {
        const orderMap = { "Ketua Umum OSIS": 1, "Ketua 2 OSIS": 2, "Ketua Umum DPK": 3, "Ketua 2 DPK": 4 };
        const wa = orderMap[a.id] || 99;
        const wb = orderMap[b.id] || 99;
        if (wa !== wb) return wa - wb;
        return a.id.localeCompare(b.id);
    });
}

async function downloadVotingBundleOffline(candidatesInput, onProgress) {
    revokeVotingObjectUrls();
    const candidates = normalizeCandidatesList(candidatesInput);
    if (candidates.length === 0) return null;

    const positions = buildVoterConfigPositions(candidates);
    if (!positions.length) return null;

    const notify = (msg) => {
        if (typeof onProgress === 'function') onProgress(msg);
    };

    const isFreeQueue = getLoginQueueProfile() === 'free';
    await sleepMs(jitterMs(isFreeQueue ? 400 : 150, isFreeQueue ? 950 : 350));

    const imageMap = {};
    const uniqueRefs = [...new Set(candidates.map(c => c.foto).filter(Boolean))];
    const resolvedByRef = {};
    const PHOTO_DOWNLOAD_CONCURRENCY = isFreeQueue ? 2 : 4;
    let doneCount = 0;

    notify(`Mengunduh foto kandidat (0/${uniqueRefs.length || 0})...`);

    if (uniqueRefs.length) {
        await runWithConcurrency(uniqueRefs, PHOTO_DOWNLOAD_CONCURRENCY, async (ref) => {
            const cachedAsset = getCachedAssetLocalUrl(ref);
            if (cachedAsset) {
                resolvedByRef[ref] = cachedAsset;
                doneCount += 1;
                notify(`Mengunduh foto kandidat (${doneCount}/${uniqueRefs.length})...`);
                return;
            }
            const remote = resolveCandidatePhotoUrl(ref);
            try {
                resolvedByRef[ref] = await fetchAssetAsLocalUrl(remote);
            } catch (e) {
                resolvedByRef[ref] = CANDIDATE_PLACEHOLDER_IMG;
            }
            doneCount += 1;
            notify(`Mengunduh foto kandidat (${doneCount}/${uniqueRefs.length})...`);
        });
    }

    candidates.forEach((cand) => {
        imageMap[cand.id] = cand.foto
            ? (resolvedByRef[cand.foto] || CANDIDATE_PLACEHOLDER_IMG)
            : CANDIDATE_PLACEHOLDER_IMG;
    });

    notify('Menyiapkan logo sekolah...');
    const logoRef = AppStorage.get('ep_sh_logo') || DEFAULT_SYSTEM_SETTINGS.schoolLogo;
    let logoSrc = getCachedAssetLocalUrl(logoRef) || CANDIDATE_PLACEHOLDER_IMG;
    if (logoSrc === CANDIDATE_PLACEHOLDER_IMG) {
        try {
            const resolvedLogo = await resolveImage(logoRef);
            logoSrc = await fetchAssetAsLocalUrl(resolvedLogo || logoRef);
        } catch (e) {
            try {
                logoSrc = await fetchAssetAsLocalUrl(logoRef);
            } catch (err) {
                logoSrc = CANDIDATE_PLACEHOLDER_IMG;
            }
        }
    }
    voterOfflineLogoSrc = logoSrc;

    return { candidates, imageMap, positions, logoSrc, offline: true };
}

function getCandidateImageSrc(candId) {
    return voterCandidateImageMap[candId] || CANDIDATE_PLACEHOLDER_IMG;
}

function updateVoterHeaderSubtitle(nameEl) {
    const subtitleEl = document.getElementById('voterHeaderSubtitle');
    if (!subtitleEl) return;
    const examTitle = AppStorage.get('ep_ex_title') || DEFAULT_SYSTEM_SETTINGS.examTitle;

    subtitleEl.textContent = examTitle;
    subtitleEl.setAttribute('data-fit-text', examTitle);

    if (isMobilePortraitView()) {
        fitElectionTitleToContainer(subtitleEl);
    } else {
        subtitleEl.style.fontSize = '';
        subtitleEl.style.lineHeight = '';
        subtitleEl.style.whiteSpace = '';
        subtitleEl.style.overflow = '';
    }
}

function updateVoterHeaderResponsive() {
    const schoolEl = document.getElementById('voterHeaderSchool');
    const nameEl = document.getElementById('voterActiveName');
    const fullSchoolName = AppStorage.get('ep_sh_name') || DEFAULT_SYSTEM_SETTINGS.schoolName;
    const isMobilePortrait = isMobilePortraitView();

    if (schoolEl) {
        const displaySchoolName = fullSchoolName;
        schoolEl.textContent = displaySchoolName;
        schoolEl.setAttribute('data-fit-text', displaySchoolName);
        schoolEl.title = fullSchoolName;
        fitSchoolNameToContainer(schoolEl);
    }

    if (!window.currentVoter) return;

    const kelas = window.currentVoter.kelas ? ` (${window.currentVoter.kelas})` : "";
    const displayName = isMobilePortrait
        ? formatLongNameForMobile(window.currentVoter.name)
        : window.currentVoter.name;
    if (nameEl) {
        nameEl.textContent = displayName + kelas;
        nameEl.title = window.currentVoter.name + kelas;
    }

    updateVoterHeaderSubtitle(nameEl);
    requestAnimationFrame(() => updateVoterHeaderSubtitle(nameEl));

    updateMobileFormattedNames();
}

window.addEventListener('resize', () => {
    updateVoterHeaderResponsive();
    updateMobileFormattedNames();
    scheduleWizardFitTexts();
});
window.addEventListener('orientationchange', () => {
    updateVoterHeaderResponsive();
    updateMobileFormattedNames();
    scheduleWizardFitTexts();
});

async function startVotingWizard(prefetched, options = {}) {
    if (!prefetched || !prefetched.offline || !prefetched.candidates || !prefetched.positions) {
        throw new Error('Paket offline pemilihan tidak tersedia. Login ulang untuk mengunduh data.');
    }

    voterAllCandidates = prefetched.candidates;
    voterCandidateImageMap = prefetched.imageMap || {};
    voterConfigPositions = (prefetched.positions || []).filter(pos =>
        (prefetched.candidates || []).some(c => String(c.posisi) === String(pos.id))
    );
    voterDraftSelections = {};

    if (voterAllCandidates.length === 0) {
        throw new Error('Belum ada kandidat yang terdaftar. Hubungi panitia.');
    }

    if (!voterConfigPositions || voterConfigPositions.length === 0) {
        throw new Error('Data posisi kandidat belum lengkap. Hubungi panitia.');
    }

    voterCurrentStep = 0;

    showVoterView();
    hideLoginView();
    updateVoterHeaderResponsive();

    const logoEl = document.getElementById('voterHeaderLogo');
    if (logoEl) {
        logoEl.src = prefetched.logoSrc || voterOfflineLogoSrc || CANDIDATE_PLACEHOLDER_IMG;
    }

    renderWizardStep();
    forceMobileImmersiveViewport();
    if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
    if (isMobileVotingDevice()) {
        const wizard = document.getElementById('wizardContent');
        const voterView = document.getElementById('voterView');
        if (voterView) void voterView.offsetHeight;
        if (wizard) void wizard.offsetHeight;
    }

    let fsPromise = Promise.resolve();
    if (options.requestFullscreenSync && !isIOSDevice() && supportsDocumentFullscreen()) {
        fsPromise = kickoffNativeFullscreenFromGesture();
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    startVotingBoothTimer();
    forceMobileImmersiveViewport();

    if (options.requestFullscreenSync && !isIOSDevice()) {
        await Promise.race([
            fsPromise,
            new Promise((resolve) => setTimeout(resolve, 1500))
        ]);
        forceMobileImmersiveViewport();
    }
}

function renderWizardStep() {
    const contentEl = document.getElementById('wizardContent');
    const progressBar = document.getElementById('wizardProgress');
    const backBtn = document.getElementById('wizardBackBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    if (!contentEl) return;

    const total = voterConfigPositions.length;
    const isSummary = voterCurrentStep >= total;

    const pct = isSummary ? 100 : Math.round((voterCurrentStep / total) * 100);
    if (progressBar) progressBar.style.width = pct + '%';

    if (backBtn) {
        backBtn.classList.toggle('invisible', voterCurrentStep === 0);
    }

    if (isSummary) {
        contentEl.classList.remove('wizard-content--candidates');
        if (nextBtn) { nextBtn.textContent = ''; nextBtn.classList.add('hidden'); }

        let summaryHtml = `
            <div class="p-4 sm:p-6 max-w-2xl mx-auto w-full">
                <h2 class="text-2xl font-black text-white text-center mb-2">Konfirmasi Pilihan</h2>
                <div class="space-y-3 mb-8">
        `;
        for (const pos of voterConfigPositions) {
            const selectedCandId = voterDraftSelections[pos.id];
            const candidate = voterAllCandidates.find(c => String(c.id) === String(selectedCandId));
            const imgSrc = candidate ? getCandidateImageSrc(candidate.id) : '';
            const imgHtml = imgSrc
                ? `<img src="${imgSrc}" alt="" fetchpriority="high" decoding="async" class="w-full h-full object-cover">`
                : `<div class="w-full h-full flex items-center justify-center text-slate-500"><i class="fas fa-user text-xl"></i></div>`;
            summaryHtml += `
                <div class="flex items-center gap-4 p-3 sm:p-4 rounded-xl bg-white/5 border border-white/10">
                    <div class="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-slate-800 border border-slate-600">${imgHtml}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs text-sky-300 font-semibold">${escapeHtml(pos.nama_posisi)}</p>
                        <p class="text-sm font-bold text-white truncate"${candidate ? ` data-full-name="${escapeHtmlAttr(candidate.nama)}" title="${escapeHtmlAttr(candidate.nama)}"` : ''}>${candidate ? escapeHtml(formatDisplayName(candidate.nama)) : '<span class="text-rose-400">Belum dipilih</span>'}</p>
                    </div>
                    <i class="${candidate ? 'fas fa-check-circle text-emerald-500' : 'fas fa-exclamation-triangle text-rose-500'} text-lg flex-shrink-0"></i>
                </div>
            `;
        }
        const allSelected = voterConfigPositions.every(p => voterDraftSelections[p.id]);
        summaryHtml += `
                </div>
                <button id="btnSubmitVote" onclick="submitFinalVote()" ${!allSelected ? 'disabled' : ''}
                    class="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all flex items-center justify-center gap-2 ${allSelected
                ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:shadow-lg hover:shadow-emerald-500/30'
                : 'bg-slate-700 opacity-50 cursor-not-allowed'
            }">
                    <i class="fas fa-paper-plane"></i> Kirim Suara Sekarang
                </button>
                ${!allSelected ? '<p class="text-rose-400 text-xs text-center mt-2">Harap pilih semua kandidat sebelum mengirim suara.</p>' : ''}
            </div>
        `;
        contentEl.innerHTML = summaryHtml;
        updateMobileFormattedNames();
        scheduleWizardFitTexts();
    } else {
        contentEl.classList.add('wizard-content--candidates');
        const pos = voterConfigPositions[voterCurrentStep];
        const hasSelected = !!voterDraftSelections[pos.id];
        if (nextBtn) {
            nextBtn.innerHTML = 'Lanjut <i class="fas fa-arrow-right text-xs"></i>';
            if (hasSelected) {
                nextBtn.classList.remove('invisible');
                nextBtn.classList.remove('hidden');
                nextBtn.disabled = false;
            } else {
                nextBtn.classList.add('invisible');
                nextBtn.classList.remove('hidden');
                nextBtn.disabled = true;
            }
        }

        const candidates = voterAllCandidates
            .filter(c => String(c.posisi) === String(pos.id))
            .sort((a, b) => (parseInt(a.nomor_urut, 10) || 0) - (parseInt(b.nomor_urut, 10) || 0));

        if (candidates.length === 0) {
            if (voterCurrentStep < voterConfigPositions.length - 1) {
                voterCurrentStep++;
            } else {
                voterCurrentStep = voterConfigPositions.length;
            }
            renderWizardStep();
            return;
        }

        let html = `
            <div class="w-full h-full flex flex-col min-h-0 wizard-candidate-step px-2 sm:px-4">
                <div class="wizard-candidate-step-header flex-none shrink-0 w-full text-center px-2 pb-3">
                    <h2 class="text-xl sm:text-2xl font-black text-white mb-0.5">Pilih ${escapeHtml(pos.nama_posisi)}</h2>
                    <p class="text-slate-400 text-xs">Silakan pilih kandidat terbaik menurut Anda.</p>
                </div>
                <div class="wizard-candidate-cards flex-1 min-h-0 w-full overflow-y-auto custom-scroll">
                    <div class="flex flex-wrap lg:flex-nowrap gap-4 sm:gap-6 justify-center items-stretch w-full max-w-7xl mx-auto pb-2">
        `;
        for (const cand of candidates) {
            const isSelected = String(voterDraftSelections[pos.id]) === String(cand.id);
            const hasSelection = !!voterDraftSelections[pos.id];
            const dimClass = hasSelection && !isSelected ? ' candidate-card--dimmed' : '';
            const selectedClass = isSelected ? ' candidate-card--selected' : '';
            const imgSrc = getCandidateImageSrc(cand.id);
            html += `
                <div data-candidate-card data-pos-id="${escapeHtmlAttr(pos.id)}" data-candidate-id="${escapeHtmlAttr(cand.id)}"
                    class="w-full sm:w-[240px] md:w-[260px] lg:w-0 lg:flex-1 lg:min-w-[200px] lg:max-w-[280px] flex flex-col relative group cursor-pointer
                        bg-white/5 border-2 ${isSelected ? 'border-sky-500 bg-sky-900/30' : 'border-white/10 hover:border-white/30'}
                        rounded-2xl overflow-hidden candidate-card${selectedClass}${dimClass}">
                    ${isSelected ? '<div class="candidate-selected-badge absolute top-3 right-3 bg-sky-500 text-white w-8 h-8 rounded-full flex items-center justify-center z-20 shadow-lg"><i class="fas fa-check"></i></div>' : ''}
                    <div class="candidate-card-photo flex-1 min-h-[180px] w-full overflow-hidden bg-slate-800 relative">
                        <div class="absolute top-0 left-0 bg-gradient-to-br from-indigo-600 to-blue-700 text-white font-black text-2xl w-12 h-12 flex items-center justify-center rounded-br-2xl shadow-lg z-10">${escapeHtml(cand.nomor_urut)}</div>
                        <img src="${imgSrc}" alt="${escapeHtmlAttr(cand.nama)}" fetchpriority="high" decoding="async" class="w-full h-full object-cover candidate-card-photo-img">
                    </div>
                    <div class="p-4 flex-none candidate-card-footer min-w-0">
                        <h3 class="text-white font-bold leading-tight mb-1 candidate-card-name-fit w-full text-left" data-fit-max="15" data-fit-min="7" data-fit-lines="3" data-fit-text="${escapeHtmlAttr(cand.nama)}" title="${escapeHtmlAttr(cand.nama)}">${escapeHtml(cand.nama)}</h3>
                        <p class="text-sky-300 font-semibold mb-3 candidate-card-fit-text" data-fit-max="11" data-fit-min="8" data-fit-lines="1" data-fit-text="Kelas: ${escapeHtmlAttr(cand.kelas || '-')}">Kelas: ${escapeHtml(cand.kelas || '-')}</p>
                        <button type="button" data-action="visi-misi" data-candidate-id="${escapeHtmlAttr(cand.id)}"
                            class="w-full py-2 border-2 border-sky-500 rounded-lg text-sky-300 text-xs sm:text-sm font-semibold hover:bg-sky-500/15 hover:text-sky-200 hover:border-sky-400 transition-colors">
                            Lihat Visi &amp; Misi
                        </button>
                    </div>
                </div>
            `;
        }
        html += `</div></div></div>`;
        contentEl.innerHTML = html;
        updateMobileFormattedNames();
        scheduleWizardFitTexts();
    }
}

function updateCandidateSelectionUI(posId, candId) {
    const selectedId = String(candId);
    document.querySelectorAll('[data-candidate-card]').forEach(card => {
        const samePos = String(card.dataset.posId) === String(posId);
        const isSelected = samePos && String(card.dataset.candidateId) === selectedId;
        card.classList.toggle('border-sky-500', isSelected);
        card.classList.toggle('bg-sky-900/30', isSelected);
        card.classList.toggle('border-white/10', samePos && !isSelected);
        card.classList.toggle('candidate-card--selected', isSelected);
        card.classList.toggle('candidate-card--dimmed', samePos && !isSelected);

        let badge = card.querySelector('.candidate-selected-badge');
        if (isSelected && !badge) {
            badge = document.createElement('div');
            badge.className = 'candidate-selected-badge absolute top-3 right-3 bg-sky-500 text-white w-8 h-8 rounded-full flex items-center justify-center z-20 shadow-lg';
            badge.innerHTML = '<i class="fas fa-check"></i>';
            card.appendChild(badge);
        } else if (!isSelected && badge) {
            badge.remove();
        }
    });

    const nextBtn = document.getElementById('wizardNextBtn');
    if (nextBtn) {
        nextBtn.classList.remove('invisible');
        nextBtn.classList.remove('hidden');
        nextBtn.disabled = false;
    }
}

function selectCandidate(posId, candId) {
    voterDraftSelections[posId] = candId;
    updateCandidateSelectionUI(posId, candId);
}

function forceWizardNavFullscreen() {
    forceMobileImmersiveViewport();
    if (isIOSDevice() || isFullscreenActive()) return;
    if (supportsDocumentFullscreen()) {
        kickoffNativeFullscreenFromGesture();
    }
}

function wizardNextStep() {
    forceWizardNavFullscreen();
    if (voterCurrentStep < voterConfigPositions.length) {
        const pos = voterConfigPositions[voterCurrentStep];
        if (!voterDraftSelections[pos.id]) {
            alert('Silakan pilih salah satu kandidat terlebih dahulu.');
            return;
        }
        voterCurrentStep++;
        renderWizardStep();
    }
}

function wizardPrevStep() {
    forceWizardNavFullscreen();
    if (voterCurrentStep <= 0) return;
    let step = voterCurrentStep - 1;
    while (step > 0) {
        const pos = voterConfigPositions[step];
        const hasCandidates = (voterAllCandidates || []).some(c => String(c.posisi) === String(pos.id));
        if (hasCandidates) break;
        step--;
    }
    voterCurrentStep = step;
    renderWizardStep();
}

function placeOverlayForDisplay(el) {
    if (!el) return;
    const fs = document.fullscreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
        || document.mozFullScreenElement;
    if (fs && !fs.contains(el)) {
        fs.appendChild(el);
    }
}

function showCandidateVisiMisi(candId) {
    const cand = voterAllCandidates.find(c => String(c.id) === String(candId));
    if (!cand) {
        alert('Data kandidat tidak ditemukan. Silakan muat ulang halaman.');
        return;
    }

    let misiHtml = '<p class="visi-misi-text text-sm text-slate-300">-</p>';
    if (cand.misi && String(cand.misi).trim() !== '') {
        const misiLines = String(cand.misi).split('\n').filter(line => line.trim() !== '');
        if (misiLines.length > 0) {
            misiHtml = '<ol class="visi-misi-list text-sm text-slate-200">';
            misiLines.forEach(line => {
                let cleanLine = line.trim().replace(/^[\d.\-)]+\s*/, '');
                if (cleanLine) misiHtml += `<li>${escapeHtml(cleanLine)}</li>`;
            });
            misiHtml += '</ol>';
        }
    }

    const visiMisiModal = document.getElementById('visiMisiModal');
    if (!visiMisiModal) {
        alert(`VISI:\n${cand.visi || '-'}\n\nMISI:\n${cand.misi || '-'}`);
        return;
    }

    document.getElementById('visiMisiModalTitle').innerHTML = `Visi &amp; Misi:<br><span class="text-sky-400">${escapeHtml(cand.nama)}</span>`;
    document.getElementById('visiMisiModalBody').innerHTML = `
        <div class="visi-misi-visi-block">
            <h4 class="visi-misi-heading visi-misi-heading--visi">
                <i class="fas fa-eye" aria-hidden="true"></i><span>Visi</span>
            </h4>
            <p class="visi-misi-text text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">${escapeHtml(cand.visi || '-')}</p>
        </div>
        <div class="visi-misi-misi-block">
            <h4 class="visi-misi-heading visi-misi-heading--misi">
                <i class="fas fa-bullseye" aria-hidden="true"></i><span>Misi</span>
            </h4>
            ${misiHtml}
        </div>
    `;
    placeOverlayForDisplay(visiMisiModal);
    visiMisiModal.classList.add('active');
}

const VOTE_SUCCESS_MODAL_HTML = '<div class="text-center py-4"><i class="fas fa-check-circle text-emerald-500 text-5xl mb-4"></i><p class="text-white text-lg font-bold mt-2">Terima kasih atas partisipasi Anda!</p><p class="text-slate-300 text-sm">Suara Anda telah direkam dengan aman.</p></div>';
const VOTE_SUBMIT_MIN_MS = 3000;
const VOTE_SUBMIT_MAX_ATTEMPTS = 4;

function isNonRetryableVoteError(message) {
    const msg = String(message || '').toLowerCase();
    return /sudah pernah|sudah memberikan|tidak valid|kosong|akun tidak ditemukan|jenis pemilih|data pilihan|sesi voting|session_token|kedaluwarsa|login ulang/.test(msg);
}

async function submitVoteRpcWithRetry(voterId, voterType, votesPayload, sessionToken) {
    let lastError = null;
    await sleepMs(jitterMs(0, 400));

    for (let attempt = 1; attempt <= VOTE_SUBMIT_MAX_ATTEMPTS; attempt++) {
        try {
            const { data: rpcResult, error: rpcError } = await db.rpc('submit_vote', {
                p_voter_id: voterId,
                p_voter_type: voterType,
                p_votes: votesPayload,
                p_session_token: sessionToken
            });
            if (rpcError) throw new Error(rpcError.message || 'Gagal mengirim suara');
            if (!rpcResult || !rpcResult.success) {
                const bizMsg = rpcResult?.error || rpcResult?.message || 'Gagal mengirim suara.';
                const err = new Error(bizMsg);
                err.nonRetryable = isNonRetryableVoteError(bizMsg);
                throw err;
            }
            return rpcResult;
        } catch (err) {
            lastError = err;
            if (err && err.nonRetryable) throw err;
            if (attempt >= VOTE_SUBMIT_MAX_ATTEMPTS) break;
            const backoff = Math.min(3500, 280 * Math.pow(2, attempt - 1)) + jitterMs(0, 350);
            await sleepMs(backoff);
        }
    }
    throw lastError || new Error('Gagal mengirim suara.');
}

function showVoteSubmitLoading(show) {
    const overlay = document.getElementById('voteSubmitOverlay');
    if (!overlay) return;
    if (show) placeOverlayForDisplay(overlay);
    overlay.classList.toggle('hidden', !show);
    overlay.classList.toggle('active', show);
    if (!show) return;

    const bar = overlay.querySelector('.vote-submit-progress-bar');
    if (bar) {
        bar.style.transition = 'none';
        bar.style.width = '0%';
        requestAnimationFrame(() => {
            bar.style.transition = `width ${VOTE_SUBMIT_MIN_MS}ms linear`;
            bar.style.width = '100%';
        });
    }
}

function finishVoteSuccess() {
    resetVotingBoothTimerState();
    if (window.currentVoter) window.currentVoter.sessionToken = '';
    document.querySelectorAll('#voterView button[onclick*="logoutVoter"]').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('opacity-40', 'pointer-events-none');
    });
    showModal('Voting Berhasil!', VOTE_SUCCESS_MODAL_HTML, false, 'Keluar', () => {
        logoutVoter();
    });
}

let voteSubmitting = false;

async function submitFinalVote() {
    const btnSubmit = document.getElementById('btnSubmitVote');
    if (!btnSubmit || voteSubmitting) return;

    if (!window.currentVoter || !window.currentVoter.id) {
        alert('Sesi pemilih tidak valid. Silakan login ulang.');
        logoutVoter();
        return;
    }

    if (!window.currentVoter.sessionToken) {
        alert('Sesi voting tidak valid. Silakan login ulang.');
        logoutVoter();
        return;
    }

    if (!voterConfigPositions.length ||
        !voterConfigPositions.every(p => voterDraftSelections[p.id])) {
        alert('Harap pilih semua kandidat sebelum mengirim suara.');
        return;
    }

    const validByPos = new Map((voterAllCandidates || []).map(c => [String(c.id), String(c.posisi)]));
    const votesPayload = voterConfigPositions.map(pos => ({
        kandidat_id: voterDraftSelections[pos.id]
    }));
    if (votesPayload.some((v, idx) => {
        const posId = String(voterConfigPositions[idx].id);
        const candId = String(v.kandidat_id || '');
        return !candId || validByPos.get(candId) !== posId;
    })) {
        alert('Data pilihan tidak valid. Silakan pilih ulang kandidat.');
        return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('Tidak ada koneksi. Hubungkan internet lalu kirim suara (1x tulis). Pilihan Anda masih tersimpan di perangkat.');
        return;
    }

    if (votingBoothExpired || (votingBoothDeadlineMs && Date.now() >= votingBoothDeadlineMs)) {
        handleVotingBoothTimeout().catch((err) => {
            console.error('Gagal menangani timeout bilik suara:', err);
        });
        return;
    }

    voteSubmitting = true;
    btnSubmit.disabled = true;
    showVoteSubmitLoading(true);
    document.querySelectorAll('#voterView button[onclick*="logoutVoter"]').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('opacity-40', 'pointer-events-none');
    });

    const voterType = window.currentVoter.type || 'siswa';
    const voterId = window.currentVoter.id;
    const sessionToken = window.currentVoter.sessionToken;

    try {
        const [rpcResult] = await Promise.all([
            submitVoteRpcWithRetry(voterId, voterType, votesPayload, sessionToken),
            new Promise(resolve => setTimeout(resolve, VOTE_SUBMIT_MIN_MS))
        ]);

        if (!rpcResult || !rpcResult.success) {
            throw new Error(rpcResult?.message || rpcResult?.error || 'Gagal mengirim suara.');
        }

        showVoteSubmitLoading(false);
        clearVotingBackGuard();
        finishVoteSuccess();
    } catch (error) {
        console.error("Voting Failed:", error);
        showVoteSubmitLoading(false);
        voteSubmitting = false;
        document.querySelectorAll('#voterView button[onclick*="logoutVoter"]').forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-40', 'pointer-events-none');
        });
        const offlineHint = (typeof navigator !== 'undefined' && navigator.onLine === false)
            ? ' Tidak ada koneksi — pilih ulang kirim setelah online.'
            : '';
        alert("Gagal mengirim suara: " + error.message + offlineHint);
        btnSubmit.disabled = false;
        if (votingBoothTimedOutDuringSubmit || votingBoothExpired || (votingBoothDeadlineMs && Date.now() >= votingBoothDeadlineMs)) {
            handleVotingBoothTimeout().catch((err) => {
                console.error('Gagal menangani timeout bilik suara:', err);
            });
            return;
        }
        resumeVotingBoothTimer();
    }
}

function logoutVoter() {
    resetVotingBoothTimerState();
    const sessionToken = takeCurrentSessionToken();
    clearVotingBackGuard();
    revokeVotingObjectUrls();
    exitAppFullscreen();
    window.currentVoter = null;
    const reload = () => window.location.reload();
    if (sessionToken) {
        releaseVotingSessionToken(sessionToken).finally(reload);
        return;
    }
    reload();
}

let votingBackArmed = false;

function isVoterViewVisible() {
    const voterView = document.getElementById('voterView');
    return !!(voterView && !voterView.classList.contains('hidden'));
}

function ensureAppSurfaceVisible() {
    const loginView = UI?.viewLogin || document.getElementById('loginView');
    const voterView = document.getElementById('voterView');
    if (!loginView || !voterView) return false;

    const loginHidden = loginView.classList.contains('hidden');
    const voterHidden = voterView.classList.contains('hidden');

    if (loginHidden && voterHidden) {
        loginView.classList.remove('hidden');
        clearImmersiveFallback();
        if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
        return true;
    }

    if (!voterHidden && !boothEntryTransition && !loginAwaitingConfirm) {
        const wizard = document.getElementById('wizardContent');
        const hasWizardContent = !!(wizard && wizard.childElementCount > 0);
        if (!hasWizardContent) {
            voterView.classList.add('hidden');
            loginView.classList.remove('hidden');
            clearImmersiveFallback();
            clearVotingBackGuard();
            const stuckToken = takeCurrentSessionToken();
            window.currentVoter = null;
            if (stuckToken) releaseVotingSessionToken(stuckToken);
            unlockLoginForm();
            if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
            return true;
        }
    }

    return false;
}

function armVotingBackGuard() {

    if (votingBackArmed && history.state && history.state.pilkasisVoting) return;
    try {
        history.pushState({ pilkasisVoting: true }, '');
        votingBackArmed = true;
    } catch (e) {
        votingBackArmed = false;
    }
}

function clearVotingBackGuard() {
    if (!votingBackArmed) return;
    votingBackArmed = false;
    if (!(history.state && history.state.pilkasisVoting)) return;
    try {
        history.replaceState(null, '', window.location.href);
    } catch (e) { }
}

window.addEventListener('popstate', () => {
    if (boothEntryTransition || loginAwaitingConfirm) return;
    if (!isVoterViewVisible() || !window.currentVoter) {
        votingBackArmed = false;
        return;
    }

    votingBackArmed = false;

    const visiMisiModal = document.getElementById('visiMisiModal');
    if (visiMisiModal && visiMisiModal.classList.contains('active')) {
        visiMisiModal.classList.remove('active');
        armVotingBackGuard();
        return;
    }

    const voteOverlay = document.getElementById('voteSubmitOverlay');
    if (voteOverlay && !voteOverlay.classList.contains('hidden')) {
        armVotingBackGuard();
        return;
    }

    const customModal = document.getElementById('customModal');
    if (customModal && customModal.classList.contains('active')) {
        if (window.currentVoter && !window.currentVoter.sessionToken) {
            customModal.classList.remove('active');
            logoutVoter();
            return;
        }
        armVotingBackGuard();
        return;
    }

    if (voterCurrentStep > 0) {
        wizardPrevStep();
        armVotingBackGuard();
        return;
    }

    armVotingBackGuard();
});

(function bindWizardContentClicks() {
    const contentEl = document.getElementById('wizardContent');
    if (!contentEl || contentEl.dataset.pilkasisBound === '1') return;
    contentEl.dataset.pilkasisBound = '1';
    contentEl.addEventListener('click', (e) => {
        const visiBtn = e.target.closest('[data-action="visi-misi"]');
        if (visiBtn) {
            e.preventDefault();
            e.stopPropagation();
            showCandidateVisiMisi(visiBtn.getAttribute('data-candidate-id'));
            return;
        }
        const card = e.target.closest('[data-candidate-card]');
        if (card) {
            const posId = card.getAttribute('data-pos-id');
            const candId = card.getAttribute('data-candidate-id');
            if (posId && candId) selectCandidate(posId, candId);
        }
    });
})();

const togglePasswordBtn = document.getElementById('togglePasswordBtn');
if (togglePasswordBtn) {
    togglePasswordBtn.onclick = () => {
        const passInput = document.getElementById('voterLoginPass');
        const toggleIcon = document.getElementById('toggleIcon');
        if (passInput && toggleIcon) {
            const isPassword = passInput.type === 'password';
            passInput.type = isPassword ? 'text' : 'password';
            toggleIcon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
    };
}

['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach((evt) => {
    document.addEventListener(evt, () => {
        if (isFullscreenActive() && isMobileVotingDevice()) {
            forceMobileImmersiveViewport();
        } else if (!isFullscreenActive() && isMobileVotingDevice() && isVoterViewVisible()) {
            forceMobileImmersiveViewport();
        }
    });
});

(function patchBoothModalConfirmForGesture() {
    if (!UI || !UI.mConfirm || UI.mConfirm.dataset.pilkasisGesturePatch === '1') return;
    UI.mConfirm.dataset.pilkasisGesturePatch = '1';
    UI.mConfirm.onclick = async function patchedBoothModalConfirm() {
        if (UI.mConfirm.disabled) return;
        UI.mConfirm.disabled = true;
        holdVotingSessionRelease(getVotingSessionHoldMs());
        boothEntryTransition = true;
        forceMobileImmersiveViewport();
        if (typeof clearLoginReadyModalGuard === 'function') clearLoginReadyModalGuard();
        const cb = typeof window.getPilkasisModalCallback === 'function' ? window.getPilkasisModalCallback() : null;
        if (!cb) {
            boothEntryTransition = false;
            loginAwaitingConfirm = false;
            UI.mConfirm.disabled = false;
            if (typeof window.closeVoterModal === 'function') window.closeVoterModal();
            return;
        }
        try {
            await cb();
        } catch (err) {
            console.error('Modal confirm error:', err);
        } finally {
            const voterView = document.getElementById('voterView');
            const wizard = document.getElementById('wizardContent');
            const voterVisible = isVoterViewVisible();
            let hasWizardContent = !!(wizard && wizard.childElementCount > 0);

            if (voterVisible) {
                if (!hasWizardContent && voterConfigPositions.length > 0) {
                    renderWizardStep();
                    if (typeof scheduleWizardFitTexts === 'function') scheduleWizardFitTexts();
                }
                forceMobileImmersiveViewport();
                if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                hasWizardContent = !!(wizard && wizard.childElementCount > 0);
            }

            const surfaceReady = isVoterSurfaceReady(voterView, wizard);
            const loginVisible = !!(UI.viewLogin && !UI.viewLogin.classList.contains('hidden'));

            if (voterVisible && !hasWizardContent && !loginVisible) {
                console.warn('Bilik belum siap setelah transisi — memulihkan layar login.');
                clearVotingBackGuard();
                if (voterView) voterView.classList.add('hidden');
                if (UI.viewLogin) UI.viewLogin.classList.remove('hidden');
                clearImmersiveFallback();
                exitAppFullscreen();
                revokeVotingObjectUrls();
                const stuckToken = window.currentVoter?.sessionToken || '';
                if (window.currentVoter) window.currentVoter.sessionToken = '';
                if (stuckToken) releaseVotingSessionToken(stuckToken);
                window.currentVoter = null;
                unlockLoginForm();
                if (UI.loginStatus) {
                    setLoginStatus('Gagal menampilkan bilik suara. Ketuk Masuk dan coba lagi.', false);
                }
                alert('Gagal menampilkan bilik suara. Silakan ketuk Masuk dan coba lagi.');
            } else if (voterVisible && !hasWizardContent && loginVisible) {
                if (voterView) voterView.classList.add('hidden');
                clearImmersiveFallback();
                exitAppFullscreen();
            } else if (voterVisible && hasWizardContent && !surfaceReady) {
                forceMobileImmersiveViewport();
                if (typeof syncLoginBackgroundViewport === 'function') syncLoginBackgroundViewport();
                if (typeof scheduleWizardFitTexts === 'function') scheduleWizardFitTexts();
            }

            if (typeof window.closeVoterModal === 'function') window.closeVoterModal();

            const boothReady = isVoterViewVisible() && !!(wizard && wizard.childElementCount > 0);
            if (boothReady) {
                holdVotingSessionRelease(getVotingSessionHoldMs());
                if (UI.form) UI.form.reset();
                if (UI.userInput) UI.userInput.disabled = false;
                if (UI.passInput) UI.passInput.disabled = false;
                if (UI.loginStatus) UI.loginStatus.classList.add('hidden');
            } else if (!UI.viewLogin || UI.viewLogin.classList.contains('hidden')) {
                if (UI.viewLogin) UI.viewLogin.classList.remove('hidden');
                if (voterView) voterView.classList.add('hidden');
                clearImmersiveFallback();
                if (!UI.loginStatus || UI.loginStatus.classList.contains('hidden')) {
                    setLoginStatus('Gagal menampilkan bilik suara. Ketuk Masuk dan coba lagi.', false);
                }
            }

            ensureAppSurfaceVisible();

            loginAwaitingConfirm = false;
            boothEntryTransition = false;
            UI.mConfirm.disabled = false;
        }
    };
})();

window.addEventListener('pageshow', () => {
    ensureAppSurfaceVisible();
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureAppSurfaceVisible();
});

if (window.visualViewport && isMobileVotingDevice()) {
    window.visualViewport.addEventListener('resize', () => {
        if (!isVoterViewVisible()) return;
        forceMobileImmersiveViewport();
    });
    window.visualViewport.addEventListener('scroll', () => {
        if (!isVoterViewVisible()) return;
        try { window.scrollTo(0, 0); } catch (e) { }
    });
}
