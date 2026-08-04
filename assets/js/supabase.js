let db = null;
if (typeof supabase !== 'undefined') {
    const { createClient } = supabase;
    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.error('Supabase SDK failed to load. Please check network connection or CDN availability.');
}

const STORAGE_BUCKET = 'pilkasis_smanda';
const CACHE_TTL_MS = {
    candidates: 15 * 60 * 1000,
    voters: 5 * 60 * 1000
};

const LOGIN_QUEUE_PROFILE_KEY = 'pilkasis_login_queue_profile';
const LOGIN_QUEUE_SETTINGS_ID = 'login_queue_settings';
const VOTER_CAPACITY_SETTINGS_ID = 'voter_capacity_settings';
const VOTING_BOOTH_DURATION_SETTINGS_ID = 'voting_booth_duration_settings';
const VOTING_WAIT_SETTINGS_ID = 'voting_wait_settings';
const VOTING_BOOTH_DURATION_KEY = 'pilkasis_voting_booth_duration_minutes';
const VOTING_WAIT_TIMEOUT_KEY = 'pilkasis_voting_wait_timeout_minutes';

const DB_SELECT = {
    KANDIDAT_LIST: 'id,nomor_urut,nama,kelas,posisi,visi,misi,foto,suara_siswa,suara_guru,suara_staf,updated_at',
    PENGATURAN_APP: 'school_name,exam_title,school_logo,login_bg',
    PENGATURAN_BOOT: 'id,school_name,exam_title,school_logo,login_bg,mode',
    LOGIN_QUEUE: 'mode',
    VOTER_CAPACITY: 'mode,active',
    VOTING_DURATION: 'mode,active',
    VOTING_WAIT: 'mode,active',
    JADWAL: 'mode,active,mulai,selesai',
    VOTER_SISWA: 'id,nama,kelas,jenis_kelamin,password,sudah_memilih,updated_at',
    VOTER_OTHER: 'id,nama,jenis_kelamin,password,sudah_memilih,updated_at'
};

const DEFAULT_SYSTEM_SETTINGS = {
    schoolName: 'SMA Negeri 2 Kuningan',
    examTitle: 'PILKASIS OSIS & DPK 2026',
    schoolLogo: 'https://iili.io/B5MMKiX.png',
    loginBg: 'https://fawclsxyvnwkmmuddhzi.supabase.co/storage/v1/object/public/pilkasis_smanda/settings/bg_8ZS782KR6Z.jpg'
};

const PILKASIS_LOGIN_BG_FALLBACK = 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 45%, #0f172a 100%)';

function normalizePilkasisAssetUrl(ref, fallback) {
    const raw = String(ref || '').trim();
    const fb = fallback || DEFAULT_SYSTEM_SETTINGS.loginBg;
    if (!raw) return fb;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    try {
        if (/^https?:\/\//i.test(raw)) {
            const currentHost = new URL(SUPABASE_URL).host;
            const host = new URL(raw).host;
            if (host.includes('.supabase.co') && host !== currentHost) return fb;
            return raw;
        }
    } catch (e) {
        return fb;
    }
    return raw;
}

function applyPilkasisLoginBackground(url) {
    const resolved = normalizePilkasisAssetUrl(url, DEFAULT_SYSTEM_SETTINGS.loginBg);
    const applyGradient = () => {
        document.documentElement.style.removeProperty('--pilkasis-login-bg');
        document.querySelectorAll('.bg-login-image').forEach((el) => {
            el.style.backgroundImage = PILKASIS_LOGIN_BG_FALLBACK;
        });
        syncLoginBackgroundViewport();
    };
    if (!resolved) {
        applyGradient();
        return;
    }
    const applyUrl = (src) => {
        const escaped = String(src).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const cssUrl = `url("${escaped}")`;
        document.documentElement.style.setProperty('--pilkasis-login-bg', cssUrl);
        document.querySelectorAll('.bg-login-image').forEach((el) => {
            el.style.backgroundImage = cssUrl;
        });
        syncLoginBackgroundViewport();
    };
    if (resolved.startsWith('data:') || resolved.startsWith('blob:')) {
        applyUrl(resolved);
        return;
    }
    const probe = new Image();
    probe.onload = () => applyUrl(resolved);
    probe.onerror = applyGradient;
    probe.decoding = 'async';
    probe.src = resolved;
}

function isMobilePortraitBackgroundView() {
    try {
        return window.matchMedia('(max-width: 1024px) and (orientation: portrait)').matches;
    } catch (e) {
        return window.innerWidth <= 1024 && window.innerHeight > window.innerWidth;
    }
}

function syncLoginBackgroundViewport() {
    const modal = document.getElementById('customModal');
    const voterView = document.getElementById('voterView');

    if (modal?.classList.contains('active') && voterView?.classList.contains('hidden')) return;

    if (!isMobilePortraitBackgroundView()) {
        document.querySelectorAll('.bg-login-image, .bg-login-overlay').forEach((el) => {
            el.style.removeProperty('width');
            el.style.removeProperty('height');
            el.style.removeProperty('min-height');
        });
        ['loginView', 'voterView'].forEach((id) => {
            const view = document.getElementById(id);
            if (view) view.style.removeProperty('min-height');
        });
        return;
    }

    const vv = window.visualViewport;
    const h = Math.max(
        Math.round(vv?.height || 0),
        Math.round(window.innerHeight || 0),
        Math.round(document.documentElement?.clientHeight || 0)
    );
    const w = Math.max(
        Math.round(vv?.width || 0),
        Math.round(window.innerWidth || 0),
        Math.round(document.documentElement?.clientWidth || 0)
    );
    if (!h || !w) return;

    document.querySelectorAll('.bg-login-image, .bg-login-overlay').forEach((el) => {
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.minHeight = h + 'px';
    });

    ['loginView', 'voterView'].forEach((id) => {
        const view = document.getElementById(id);
        if (!view || view.classList.contains('hidden')) return;
        view.style.minHeight = h + 'px';
    });
}

(function bindLoginBackgroundViewportSync() {
    if (window.__pilkasisBgViewportBound) return;
    window.__pilkasisBgViewportBound = true;
    const run = () => syncLoginBackgroundViewport();
    window.addEventListener('resize', run, { passive: true });
    window.addEventListener('orientationchange', run, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', run, { passive: true });
        window.visualViewport.addEventListener('scroll', run, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
})();

const AppStorage = {
    memoryData: {},
    get(key) {
        try { return localStorage.getItem(key) || this.memoryData[key]; }
        catch (e) { return this.memoryData[key]; }
    },
    set(key, value) {
        this.memoryData[key] = value;
        try { localStorage.setItem(key, value); } catch (e) { }
    }
};

function getAdminSession() {
    try {
        const raw = localStorage.getItem('adminSession');
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || typeof session !== 'object' || !session.user || !session.token) return null;
        return session;
    } catch (e) {
        return null;
    }
}

function setAdminSession(username, token) {
    const payload = { user: username, token: token || '', ts: Date.now() };
    try { localStorage.setItem('adminSession', JSON.stringify(payload)); } catch (e) { }
    return payload;
}

function clearAdminSession() {
    try { localStorage.removeItem('adminSession'); } catch (e) { }
}

function getAdminSessionToken() {
    const session = getAdminSession();
    return session?.token || '';
}

function isDirectImageUrl(ref) {
    return !!ref && (ref.startsWith('http') || ref.startsWith('data:'));
}

function getStoragePathFromUrl(url) {
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.slice(idx + marker.length));
}

function resolveLocalAssetUrl(key, fallback) {
    if (!key) return fallback;
    const raw = normalizePilkasisAssetUrl(String(key), fallback);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    const cached = AppStorage.get('img_' + raw);
    if (cached) return cached;
    if (isDirectImageUrl(raw)) {
        const path = getStoragePathFromUrl(raw);
        if (path) {
            const cachedByPath = AppStorage.get('img_' + path);
            if (cachedByPath) return cachedByPath;
        }
        return raw;
    }
    return fallback;
}

function getCachedAssetLocalUrl(ref) {
    if (!ref) return null;
    const raw = String(ref);
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    const cached = AppStorage.get('img_' + raw);
    if (cached) return cached;
    if (isDirectImageUrl(raw)) {
        const path = getStoragePathFromUrl(raw);
        if (path) {
            const cachedByPath = AppStorage.get('img_' + path);
            if (cachedByPath) return cachedByPath;
        }
    }
    return null;
}

function base64ToBlob(base64Data) {
    const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    const mime = match ? match[1] : 'image/jpeg';
    const raw = match ? match[2] : base64Data.replace(/^data:[^;]+;base64,/, '');
    const bytes = atob(raw);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function invalidateImageCache(idOrUrl) {
    if (!idOrUrl) return;
    try { localStorage.removeItem('img_' + idOrUrl); } catch (e) { }
    if (AppStorage.memoryData) delete AppStorage.memoryData['img_' + idOrUrl];
}

function getCachedJson(key, ttlMs) {
    const ts = parseInt(AppStorage.get(key + '_ts') || '0', 10);
    if (ttlMs && (!ts || Date.now() - ts > ttlMs)) return null;
    const raw = AppStorage.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function setCachedJson(key, data) {
    AppStorage.set(key, JSON.stringify(data));
    AppStorage.set(key + '_ts', String(Date.now()));
}

function clearCachedJson(key) {
    try {
        localStorage.removeItem(key);
        localStorage.removeItem(key + '_ts');
    } catch (e) { }
    if (AppStorage.memoryData) {
        delete AppStorage.memoryData[key];
        delete AppStorage.memoryData[key + '_ts'];
    }
}

async function saveImage(folder, filename, base64Data) {
    const blob = base64ToBlob(base64Data);
    const path = `${folder}/${filename}`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, blob, {
        upsert: true,
        contentType: blob.type || 'image/jpeg'
    });
    if (error) throw error;
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

async function deleteStoredImage(idOrUrl) {
    if (!idOrUrl || !isDirectImageUrl(idOrUrl)) return;
    invalidateImageCache(idOrUrl);
    const path = getStoragePathFromUrl(idOrUrl);
    if (!path) return;
    try {
        await db.storage.from(STORAGE_BUCKET).remove([path]);
    } catch (e) {
        console.warn('Gagal menghapus dari storage:', e);
    }
}

async function resolveImage(idOrUrl) {
    if (!idOrUrl) return null;
    if (isDirectImageUrl(idOrUrl)) return idOrUrl;
    return AppStorage.get('img_' + idOrUrl) || null;
}

async function countStorageFiles() {
    let total = 0;
    for (const folder of ['photos', 'settings']) {
        const { data } = await db.storage.from(STORAGE_BUCKET).list(folder, { limit: 1000 });
        total += (data || []).filter(item => item.metadata).length;
    }
    return total;
}

function toTitleCaseWord(word) {
    if (!word) return '';
    const lower = word.trim().toLowerCase();
    if (!lower) return '';
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isMuhammadFirstName(word) {
    const w = (word || '').trim().toUpperCase();
    return w === 'MUHAMMAD' || w === 'MUHAMAD';
}

function isMobilePortraitView() {
    return window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches;
}

function formatLongNameForMobile(fullName, options = {}) {
    const maxLength = options.maxLength ?? 22;
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';

    const titleFull = parts.map(toTitleCaseWord).join(' ');
    const needsAbbrev = parts.length >= 3 || titleFull.length > maxLength;
    if (!needsAbbrev) return titleFull;

    if (isMuhammadFirstName(parts[0])) {
        const segments = ['M.'];
        if (parts.length >= 2) segments.push(toTitleCaseWord(parts[1]));
        if (parts.length >= 3) {
            const restInitials = parts.slice(2).map(p => p.charAt(0).toUpperCase());
            segments.push(restInitials.length === 1 ? restInitials[0] : restInitials.join('.'));
        }
        return segments.join(' ');
    }

    const first = toTitleCaseWord(parts[0]);
    if (parts.length === 1) return first;
    return `${first} ${parts.slice(1).map(p => p.charAt(0).toUpperCase()).join('.')}`;
}

function formatDisplayName(fullName) {
    if (!fullName || !isMobilePortraitView()) return fullName || '';
    return formatLongNameForMobile(fullName);
}

function escapeHtmlAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
    return escapeHtmlAttr(str);
}

function updateMobileFormattedNames() {
    if (typeof formatLongNameForMobile !== 'function') return;
    const isMobile = isMobilePortraitView();
    document.querySelectorAll('[data-full-name]').forEach(el => {
        const full = el.getAttribute('data-full-name') || '';
        el.textContent = isMobile ? formatLongNameForMobile(full) : full;
        el.title = full;
    });
}

function fitTextToContainer(el, options = {}) {
    if (!el) return;
    const onlyMobile = options.onlyMobile ?? false;
    if (onlyMobile && !isMobilePortraitView()) {
        el.style.fontSize = '';
        el.style.lineHeight = '';
        el.style.whiteSpace = '';
        el.style.overflow = '';
        return;
    }

    const text = el.getAttribute('data-fit-text') || el.textContent;
    el.setAttribute('data-fit-text', text);
    el.textContent = text;

    const container = options.containerSelector
        ? el.closest(options.containerSelector)
        : (options.container || el.parentElement);
    if (!container || container.clientWidth === 0) return;

    const maxPx = options.maxPx ?? 14;
    const minPx = options.minPx ?? 8;
    const maxLines = options.maxLines ?? 2;
    const lineHeightRatio = options.lineHeight ?? 1.15;
    const singleLine = options.singleLine ?? false;

    el.style.lineHeight = String(lineHeightRatio);
    if (singleLine) {
        el.style.whiteSpace = 'nowrap';
        el.style.wordBreak = 'normal';
        el.style.overflow = 'hidden';
        el.style.textOverflow = 'clip';
    } else {
        el.style.whiteSpace = 'normal';
        el.style.wordBreak = 'break-word';
        el.style.overflow = 'visible';
        el.style.textOverflow = '';
    }

    let size = maxPx;
    el.style.fontSize = `${size}px`;

    const fits = () => {
        if (singleLine) {
            return el.scrollWidth <= container.clientWidth + 1;
        }
        const lineHeight = size * lineHeightRatio;
        const maxHeight = lineHeight * maxLines + 1;
        return el.scrollHeight <= maxHeight && el.scrollWidth <= container.clientWidth + 1;
    };

    while (size > minPx && !fits()) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
    }
}

function fitSchoolNameToContainer(el) {
    fitTextToContainer(el, {
        onlyMobile: true,
        containerSelector: '.voter-header-school-wrap',
        maxPx: 15,
        minPx: 7,
        maxLines: 1,
        singleLine: true
    });
}

function fitElectionTitleToContainer(el) {
    fitTextToContainer(el, {
        onlyMobile: true,
        containerSelector: '.voter-header-school-wrap',
        maxPx: 11,
        minPx: 6,
        maxLines: 1,
        singleLine: true
    });
}

function updateWizardFitTexts() {
    if (isMobilePortraitView()) return;

    document.querySelectorAll('.candidate-card-name-fit').forEach(el => {
        fitTextToContainer(el, {
            containerSelector: '.candidate-card-footer',
            maxPx: parseFloat(el.getAttribute('data-fit-max')) || 15,
            minPx: parseFloat(el.getAttribute('data-fit-min')) || 7,
            maxLines: parseInt(el.getAttribute('data-fit-lines') || '3', 10)
        });
    });

    document.querySelectorAll('.candidate-card-fit-text').forEach(el => {
        fitTextToContainer(el, {
            containerSelector: '.candidate-card-footer',
            maxPx: parseFloat(el.getAttribute('data-fit-max')) || 14,
            minPx: parseFloat(el.getAttribute('data-fit-min')) || 8,
            maxLines: parseInt(el.getAttribute('data-fit-lines') || '2', 10),
            onlyMobile: true
        });
    });
}

function scheduleWizardFitTexts() {
    if (isMobilePortraitView()) {
        requestAnimationFrame(updateWizardFitTexts);
        return;
    }
    requestAnimationFrame(() => {
        updateWizardFitTexts();
        requestAnimationFrame(updateWizardFitTexts);
    });
}
