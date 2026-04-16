// ============================================================
// FIREBASE
// ============================================================
var db = null;
try {
    firebase.initializeApp({
        apiKey: "AIzaSyAAECNNQJuYaOoi-Pc_QCXpOnlOsqUcAfk",
        authDomain: "berezka-4a2c5.firebaseapp.com",
        databaseURL: "https://berezka-4a2c5-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "berezka-4a2c5",
        storageBucket: "berezka-4a2c5.firebasestorage.app",
        messagingSenderId: "262260400083",
        appId: "1:262260400083:web:b7e14ba455f9290d0d5926"
    });
    db = firebase.database();
} catch (e) {
    console.error('Firebase init error:', e);
}

// ============================================================
// STATE
// ============================================================
var myUsername = '';
var myKey = '';
var visitedCountries = {};
var currentScreen = 'loading';
var mapSvg = null;
var mapGroup = null;
var viewBox = { x: -20, y: -10, w: 960, h: 500 };
var isDragging = false;
var dragStart = { x: 0, y: 0 };
var pinchDist = 0;
var countryPaths = {};

// ============================================================
// DOM REFS
// ============================================================
function $(id) { return document.getElementById(id); }

var screenLoading, screenAuth, screenMap, screenSearch, screenSettings, screenView;
var authUsername, authPassword, authError, authBtn, authTabLogin, authTabRegister;
var statsCount, countryTooltip;
var searchInput, searchResult;
var publicToggle, settingsAvatar, settingsUsername;
var modalOverlay, modalList, modalSearchInput;
var viewMapContainer, viewStatsCount, viewHeaderName, viewHeaderInfo;

function initDom() {
    screenLoading = $('screen-loading');
    screenAuth = $('screen-auth');
    screenMap = $('screen-map');
    screenSearch = $('screen-search');
    screenSettings = $('screen-settings');
    screenView = $('screen-view');
    authUsername = $('auth-username');
    authPassword = $('auth-password');
    authError = $('auth-error');
    authBtn = $('auth-btn');
    authTabLogin = $('auth-tab-login');
    authTabRegister = $('auth-tab-register');
    statsCount = $('stats-count');
    countryTooltip = $('country-tooltip');
    searchInput = $('search-input');
    searchResult = $('search-result');
    publicToggle = $('public-toggle');
    settingsAvatar = $('settings-avatar');
    settingsUsername = $('settings-username');
    modalOverlay = $('modal-overlay');
    modalList = $('modal-list');
    modalSearchInput = $('modal-search-input');
    viewMapContainer = $('view-map-container');
    viewStatsCount = $('view-stats-count');
    viewHeaderName = $('view-header-name');
    viewHeaderInfo = $('view-header-info');
}

// ============================================================
// UTILITIES
// ============================================================
function sha256(text) {
    if (window.crypto && window.crypto.subtle) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function(h) {
            var b = new Uint8Array(h), hex = '';
            for (var i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
            return hex;
        });
    }
    var hash = 0;
    for (var i = 0; i < text.length; i++) { hash = ((hash << 5) - hash) + text.charCodeAt(i); hash &= hash; }
    return Promise.resolve(Math.abs(hash).toString(16).padStart(12, '0'));
}

function sanitize(n) { return n.trim().toLowerCase().replace(/[^a-z\u0430-\u044f\u04510-9_-]/gi, ''); }
function fbKey(s) { return s.replace(/[.#$\[\]\/]/g, '_'); }

function showScreen(name) {
    var screens = [screenLoading, screenAuth, screenMap, screenSearch, screenSettings, screenView];
    screens.forEach(function(s) { if (s) s.classList.remove('active'); });
    var target = $('screen-' + name);
    if (target) target.classList.add('active');
    currentScreen = name;
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.screen === name);
    });
}

// ============================================================
// AUTH
// ============================================================
var authMode = 'login';

function setupAuth() {
    authTabLogin.addEventListener('click', function() {
        authMode = 'login';
        authTabLogin.classList.add('active');
        authTabRegister.classList.remove('active');
        authBtn.textContent = 'Войти';
        authError.textContent = '';
    });
    authTabRegister.addEventListener('click', function() {
        authMode = 'register';
        authTabRegister.classList.add('active');
        authTabLogin.classList.remove('active');
        authBtn.textContent = 'Создать аккаунт';
        authError.textContent = '';
    });
    authBtn.addEventListener('click', handleAuth);
    authPassword.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuth(); });
    authUsername.addEventListener('keydown', function(e) { if (e.key === 'Enter') authPassword.focus(); });
}

function findUserByEmail(email) {
    return db.ref('users').orderByChild('email').equalTo(email.toLowerCase().trim()).once('value').then(function(s) {
        var result = null;
        s.forEach(function(child) {
            var data = child.val();
            if (data.emailVerified) result = data;
        });
        return result;
    });
}

function handleAuth() {
    if (!db) { authError.textContent = 'Нет подключения к серверу'; return; }
    var input = authUsername.value.trim();
    var password = authPassword.value.trim();
    var isEmail = input.indexOf('@') > 0;

    if (authMode === 'register') {
        var username = sanitize(input);
        if (!username || username.length < 2) { authError.textContent = 'Логин — минимум 2 символа'; return; }
        if (!password || password.length < 4) { authError.textContent = 'Пароль — минимум 4 символа'; return; }
        var key = fbKey(username);
        sha256('berezka-pass-' + password).then(function(passHash) {
            db.ref('users/' + key).once('value').then(function(s) {
                if (s.exists()) { authError.textContent = 'Логин занят'; return; }
                db.ref('users/' + key).set({
                    username: username,
                    passHash: passHash,
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                }).then(function() {
                    localStorage.setItem('berezka_map_user', username);
                    myUsername = username;
                    myKey = key;
                    startApp();
                }).catch(function(e) { authError.textContent = e.message; });
            });
        });
    } else {
        if (!input) { authError.textContent = 'Введите логин или email'; return; }
        if (!password || password.length < 4) { authError.textContent = 'Пароль — минимум 4 символа'; return; }

        if (isEmail) {
            findUserByEmail(input).then(function(userData) {
                if (!userData) { authError.textContent = 'Пользователь с таким email не найден'; return; }
                sha256('berezka-pass-' + password).then(function(passHash) {
                    if (userData.passHash !== passHash) { authError.textContent = 'Неверный пароль'; return; }
                    localStorage.setItem('berezka_map_user', userData.username);
                    myUsername = userData.username;
                    myKey = fbKey(sanitize(userData.username));
                    startApp();
                });
            }).catch(function(e) { authError.textContent = e.message; });
        } else {
            var username = sanitize(input);
            var key = fbKey(username);
            sha256('berezka-pass-' + password).then(function(passHash) {
                db.ref('users/' + key).once('value').then(function(s) {
                    if (!s.exists()) { authError.textContent = 'Пользователь не найден'; return; }
                    if (s.val().passHash !== passHash) { authError.textContent = 'Неверный пароль'; return; }
                    localStorage.setItem('berezka_map_user', username);
                    myUsername = username;
                    myKey = key;
                    startApp();
                }).catch(function(e) { authError.textContent = e.message; });
            });
        }
    }
}

function logout() {
    localStorage.removeItem('berezka_map_user');
    myUsername = '';
    myKey = '';
    visitedCountries = {};
    authUsername.value = '';
    authPassword.value = '';
    authError.textContent = '';
    showScreen('auth');
}

// ============================================================
// MAP RENDERING (TopoJSON -> SVG)
// ============================================================
var TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

function loadWorldMap(container, onCountryClick) {
    return fetch(TOPO_URL)
        .then(function(r) { return r.json(); })
        .then(function(topo) {
            var geojson = topojson.feature(topo, topo.objects.countries);
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 20 920 420');
            // 'slice' fills container; actual visible area controlled by viewBox in setupMapInteraction
            svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');

            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            svg.appendChild(g);

            geojson.features.forEach(function(feat) {
                var numCode = feat.id || feat.properties.id;
                var alpha2 = NUM_TO_ALPHA2[numCode] || numCode;
                var pathStr = geoToPath(feat.geometry);
                if (!pathStr) return;

                var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathStr);
                path.setAttribute('id', 'c-' + alpha2);
                path.setAttribute('data-code', alpha2);
                path.classList.add('country');
                g.appendChild(path);

                // Tooltip on hover (desktop)
                path.addEventListener('mouseenter', function() {
                    var name = COUNTRY_NAMES[alpha2];
                    if (name && countryTooltip) countryTooltip.textContent = name;
                });
                path.addEventListener('mouseleave', function() {
                    if (countryTooltip) countryTooltip.textContent = '';
                });
            });

            container.innerHTML = '';
            container.appendChild(svg);

            // Delegate clicks via container-level tap detection (handled in setupMapInteraction)
            if (onCountryClick) {
                svg._onCountryTap = onCountryClick;
            }

            return { svg: svg, g: g };
        });
}

// Simple equirectangular projection
function projectPt(lon, lat) {
    return [(lon + 180) * (920 / 360), (90 - lat) * (480 / 180)];
}

function geoToPath(geom) {
    var paths = [];
    var coords = [];

    if (geom.type === 'Polygon') {
        coords = [geom.coordinates];
    } else if (geom.type === 'MultiPolygon') {
        coords = geom.coordinates;
    } else {
        return '';
    }

    coords.forEach(function(polygon) {
        polygon.forEach(function(ring) {
            var d = '';
            var needsMove = true;
            for (var i = 0; i < ring.length; i++) {
                var pt = ring[i];
                var p = projectPt(pt[0], pt[1]);
                // Detect antimeridian crossing (big longitude jump)
                if (i > 0 && Math.abs(pt[0] - ring[i-1][0]) > 90) {
                    needsMove = true;
                }
                d += (needsMove ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
                needsMove = false;
            }
            paths.push(d);
        });
    });

    return paths.join('');
}

// ============================================================
// MAP INTERACTION (Pan/Zoom + Tap)
// ============================================================
function setupMapInteraction(container, svg, zoomInBtnId, zoomOutBtnId) {
    var BASE_W = 920, BASE_H = 420;
    // Compute initial viewBox based on container aspect ratio
    var rect0 = container.getBoundingClientRect();
    var contAspect = rect0.width / rect0.height; // container width/height
    var mapAspect = BASE_W / BASE_H;
    var vb;
    if (contAspect >= mapAspect) {
        // Wide container — show whole map with some space
        vb = { x: 0, y: 20, w: BASE_W, h: BASE_W / contAspect };
        vb.y = 20 + (BASE_H - vb.h) / 2;
    } else {
        // Tall container — crop sides so map fills height
        vb = { x: 0, y: 20, w: BASE_H * contAspect, h: BASE_H };
        // Center horizontally on main landmasses (shift right to hide some Pacific)
        vb.x = (BASE_W - vb.w) / 2;
    }
    var startVb = {};
    var pointers = {};
    var startPointers = {};
    var moved = false;
    var pointerDownTime = 0;
    var pinchStartDist = 0;

    function setVB() {
        svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    }
    setVB();

    function clampVB() {
        var minW = 80, maxW = 1400;
        vb.w = Math.max(minW, Math.min(maxW, vb.w));
        vb.h = vb.w * (BASE_H / BASE_W);
        vb.x = Math.max(-300, Math.min(BASE_W - vb.w + 300, vb.x));
        vb.y = Math.max(-100, Math.min(BASE_H - vb.h + 120, vb.y));
    }

    function zoomAt(factor, clientX, clientY) {
        var rect = container.getBoundingClientRect();
        var mx = (clientX - rect.left) / rect.width;
        var my = (clientY - rect.top) / rect.height;
        var newW = vb.w * factor;
        var newH = newW * (BASE_H / BASE_W);
        vb.x += (vb.w - newW) * mx;
        vb.y += (vb.h - newH) * my;
        vb.w = newW;
        vb.h = newH;
        clampVB();
        setVB();
    }

    // Mouse wheel zoom
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        var factor = e.deltaY > 0 ? 1.2 : 0.83;
        zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    container.addEventListener('pointerdown', function(e) {
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        startPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pointers);
        if (ids.length === 1) {
            startVb = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
            moved = false;
            pointerDownTime = Date.now();
        } else if (ids.length === 2) {
            startVb = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
            var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
            pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            moved = true;
        }
        try { container.setPointerCapture(e.pointerId); } catch(err) {}
    });

    container.addEventListener('pointermove', function(e) {
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pointers);

        if (ids.length === 1) {
            var start = startPointers[e.pointerId];
            var dx = e.clientX - start.x;
            var dy = e.clientY - start.y;
            if (!moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) moved = true;
            if (moved) {
                var rect = container.getBoundingClientRect();
                var scaleX = startVb.w / rect.width;
                var scaleY = startVb.h / rect.height;
                vb.x = startVb.x - dx * scaleX;
                vb.y = startVb.y - dy * scaleY;
                clampVB();
                setVB();
            }
        } else if (ids.length === 2) {
            var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
            var dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (pinchStartDist > 0) {
                var factor = pinchStartDist / dist;
                var rect = container.getBoundingClientRect();
                var mx = ((p1.x + p2.x) / 2 - rect.left) / rect.width;
                var my = ((p1.y + p2.y) / 2 - rect.top) / rect.height;
                var newW = startVb.w * factor;
                var newH = newW * (BASE_H / BASE_W);
                vb.x = startVb.x + (startVb.w - newW) * mx;
                vb.y = startVb.y + (startVb.h - newH) * my;
                vb.w = newW;
                vb.h = newH;
                clampVB();
                setVB();
            }
            moved = true;
        }
    });

    function handlePointerEnd(e) {
        if (!pointers[e.pointerId]) return;
        var wasIds = Object.keys(pointers).length;
        var start = startPointers[e.pointerId];
        delete pointers[e.pointerId];
        delete startPointers[e.pointerId];

        if (Object.keys(pointers).length === 0) pinchStartDist = 0;

        // Tap detection: single pointer, minimal movement, short duration
        if (wasIds === 1 && !moved && start && Date.now() - pointerDownTime < 500) {
            var dx = e.clientX - start.x;
            var dy = e.clientY - start.y;
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
                // It's a tap — find country at this point
                var el = document.elementFromPoint(e.clientX, e.clientY);
                if (el && el.classList && el.classList.contains('country') && svg._onCountryTap) {
                    var code = el.dataset.code;
                    svg._onCountryTap(code, el);
                }
            }
        }
    }

    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);

    // Zoom buttons
    if (zoomInBtnId) {
        var zi = $(zoomInBtnId);
        if (zi) zi.addEventListener('click', function() {
            var rect = container.getBoundingClientRect();
            zoomAt(0.7, rect.left + rect.width/2, rect.top + rect.height/2);
        });
    }
    if (zoomOutBtnId) {
        var zo = $(zoomOutBtnId);
        if (zo) zo.addEventListener('click', function() {
            var rect = container.getBoundingClientRect();
            zoomAt(1.4, rect.left + rect.width/2, rect.top + rect.height/2);
        });
    }

    return { getVB: function() { return vb; } };
}

// ============================================================
// MY MAP LOGIC
// ============================================================
function loadMyMap() {
    var container = $('map-container');
    loadWorldMap(container, function(code, pathEl) {
        toggleCountry(code, pathEl);
    }).then(function(result) {
        mapSvg = result.svg;
        mapGroup = result.g;
        setupMapInteraction(container, mapSvg, 'zoom-in', 'zoom-out');
        loadVisitedCountries();
    });
}

function loadVisitedCountries() {
    db.ref('travel_maps/' + myKey + '/countries').on('value', function(s) {
        visitedCountries = s.val() || {};
        renderVisited();
        updateCounter();
    });
}

function renderVisited() {
    if (!mapSvg) return;
    mapSvg.querySelectorAll('.country').forEach(function(p) {
        var code = p.dataset.code;
        p.classList.toggle('visited', !!visitedCountries[code]);
    });
}

function toggleCountry(code, pathEl) {
    var isVisited = !!visitedCountries[code];
    // Firebase .on callback will update visitedCountries, DOM, and counter
    if (isVisited) {
        db.ref('travel_maps/' + myKey + '/countries/' + code).remove();
    } else {
        db.ref('travel_maps/' + myKey + '/countries/' + code).set(true);
    }
    // Save username reference (for search)
    db.ref('travel_maps/' + myKey + '/username').set(myUsername);
}

function updateCounter() {
    var count = Object.keys(visitedCountries).length;
    statsCount.innerHTML = 'Посещено: <span>' + count + '</span> / 195 стран';
}

// ============================================================
// COUNTRY LIST MODAL
// ============================================================
function openCountryList() {
    modalOverlay.classList.add('active');
    renderCountryList('');
    modalSearchInput.value = '';
    modalSearchInput.focus();
}

function closeCountryList() {
    modalOverlay.classList.remove('active');
}

function renderCountryList(filter) {
    var html = '';
    var f = filter.toLowerCase();
    var codes = Object.keys(COUNTRY_NAMES).sort(function(a, b) {
        return COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b]);
    });
    codes.forEach(function(code) {
        var name = COUNTRY_NAMES[code];
        if (f && name.toLowerCase().indexOf(f) === -1 && code.toLowerCase().indexOf(f) === -1) return;
        var checked = visitedCountries[code] ? ' checked' : '';
        html += '<div class="modal-list-item' + (checked ? ' checked' : '') + '" data-code="' + code + '">'
            + '<span class="name">' + name + '</span>'
            + '<span class="check">&#10003;</span>'
            + '</div>';
    });
    modalList.innerHTML = html || '<div class="search-msg">Ничего не найдено</div>';
}

function handleCountryListClick(e) {
    var item = e.target.closest('.modal-list-item');
    if (!item) return;
    var code = item.dataset.code;
    // Firebase .on callback will update visitedCountries, DOM, and counter
    if (visitedCountries[code]) {
        db.ref('travel_maps/' + myKey + '/countries/' + code).remove();
        item.classList.remove('checked');
    } else {
        db.ref('travel_maps/' + myKey + '/countries/' + code).set(true);
        item.classList.add('checked');
    }
    db.ref('travel_maps/' + myKey + '/username').set(myUsername);
}

// ============================================================
// SEARCH USER MAPS
// ============================================================
function searchUser() {
    var input = searchInput.value.trim();
    if (!input) return;
    var username = sanitize(input);
    var key = fbKey(username);
    searchResult.innerHTML = '<div class="search-msg">Поиск...</div>';

    db.ref('users/' + key).once('value').then(function(userSnap) {
        if (!userSnap.exists()) {
            searchResult.innerHTML = '<div class="search-error">Пользователь не найден</div>';
            return;
        }
        var userData = userSnap.val();
        var displayName = userData.displayName || userData.username || username;

        db.ref('travel_maps/' + key + '/isPublic').once('value').then(function(pubSnap) {
            if (!pubSnap.val()) {
                searchResult.innerHTML = '<div class="search-result"><h3>' + escapeHtml(displayName) + '</h3>'
                    + '<p>Карта скрыта пользователем</p></div>';
                return;
            }

            db.ref('travel_maps/' + key + '/countries').once('value').then(function(cSnap) {
                var countries = cSnap.val() || {};
                var count = Object.keys(countries).length;
                searchResult.innerHTML = '<div class="search-result"><h3>' + escapeHtml(displayName) + '</h3>'
                    + '<p>Посещено стран: ' + count + '</p>'
                    + '<button class="open-map-btn" onclick="viewUserMap(\'' + escapeHtml(key) + '\', \'' + escapeHtml(displayName) + '\')">Открыть карту</button></div>';
            });
        });
    }).catch(function(e) {
        searchResult.innerHTML = '<div class="search-error">' + e.message + '</div>';
    });
}

function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ============================================================
// VIEW OTHER USER'S MAP
// ============================================================
function viewUserMap(key, displayName) {
    viewHeaderName.textContent = displayName;
    showScreen('view');

    db.ref('travel_maps/' + key + '/countries').once('value').then(function(s) {
        var countries = s.val() || {};
        var count = Object.keys(countries).length;
        viewHeaderInfo.textContent = 'Посещено: ' + count + ' стран';

        loadWorldMap(viewMapContainer, null).then(function(result) {
            // Mark visited countries
            Object.keys(countries).forEach(function(code) {
                var p = result.svg.querySelector('[data-code="' + code + '"]');
                if (p) p.classList.add('other-visited');
            });
            setupMapInteraction(viewMapContainer, result.svg, null, null);
        });
    });
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
    settingsAvatar.textContent = myUsername.charAt(0).toUpperCase();
    settingsUsername.textContent = myUsername;

    db.ref('travel_maps/' + myKey + '/isPublic').on('value', function(s) {
        publicToggle.checked = s.val() === true;
    });
}

function handlePublicToggle() {
    db.ref('travel_maps/' + myKey + '/isPublic').set(publicToggle.checked);
    db.ref('travel_maps/' + myKey + '/username').set(myUsername);
}

// ============================================================
// NAVIGATION
// ============================================================
function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            showScreen(btn.dataset.screen);
        });
    });
}

// ============================================================
// APP START
// ============================================================
function startApp() {
    showScreen('map');
    loadMyMap();
    loadSettings();
}

function init() {
    initDom();
    setupAuth();
    setupNav();

    // Country list modal
    $('open-list-btn').addEventListener('click', openCountryList);
    $('modal-close').addEventListener('click', closeCountryList);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeCountryList();
    });
    modalSearchInput.addEventListener('input', function() {
        renderCountryList(this.value);
    });
    modalList.addEventListener('click', handleCountryListClick);

    // Search
    $('search-go').addEventListener('click', searchUser);
    searchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') searchUser(); });

    // Settings
    publicToggle.addEventListener('change', handlePublicToggle);
    $('logout-btn').addEventListener('click', logout);

    // Back button on view screen
    $('view-back').addEventListener('click', function() { showScreen('search'); });

    // Check saved session
    var saved = localStorage.getItem('berezka_map_user');
    if (saved) {
        myUsername = saved;
        myKey = fbKey(sanitize(saved));
        db.ref('users/' + myKey).once('value').then(function(s) {
            if (s.exists()) {
                startApp();
            } else {
                localStorage.removeItem('berezka_map_user');
                showScreen('auth');
            }
        }).catch(function() { showScreen('auth'); });
    } else {
        showScreen('auth');
    }
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// ISO 3166-1 numeric -> alpha-2 mapping
// ============================================================
var NUM_TO_ALPHA2 = {
    '004':'AF','008':'AL','010':'AQ','012':'DZ','016':'AS','020':'AD','024':'AO','028':'AG',
    '031':'AZ','032':'AR','036':'AU','040':'AT','044':'BS','048':'BH','050':'BD','051':'AM',
    '052':'BB','056':'BE','060':'BM','064':'BT','068':'BO','070':'BA','072':'BW','074':'BV',
    '076':'BR','084':'BZ','086':'IO','090':'SB','092':'VG','096':'BN','100':'BG','104':'MM',
    '108':'BI','112':'BY','116':'KH','120':'CM','124':'CA','132':'CV','136':'KY','140':'CF',
    '144':'LK','148':'TD','152':'CL','156':'CN','158':'TW','162':'CX','166':'CC','170':'CO',
    '174':'KM','175':'YT','178':'CG','180':'CD','184':'CK','188':'CR','191':'HR','192':'CU',
    '196':'CY','203':'CZ','204':'BJ','208':'DK','212':'DM','214':'DO','218':'EC','222':'SV',
    '226':'GQ','231':'ET','232':'ER','233':'EE','234':'FO','238':'FK','239':'GS','242':'FJ',
    '246':'FI','250':'FR','254':'GF','258':'PF','260':'TF','262':'DJ','266':'GA','268':'GE',
    '270':'GM','275':'PS','276':'DE','288':'GH','292':'GI','296':'KI','300':'GR','304':'GL',
    '308':'GD','312':'GP','316':'GU','320':'GT','324':'GN','328':'GY','332':'HT','334':'HM',
    '336':'VA','340':'HN','344':'HK','348':'HU','352':'IS','356':'IN','360':'ID','364':'IR',
    '368':'IQ','372':'IE','376':'IL','380':'IT','384':'CI','388':'JM','392':'JP','398':'KZ',
    '400':'JO','404':'KE','408':'KP','410':'KR','414':'KW','417':'KG','418':'LA','422':'LB',
    '426':'LS','428':'LV','430':'LR','434':'LY','438':'LI','440':'LT','442':'LU','446':'MO',
    '450':'MG','454':'MW','458':'MY','462':'MV','466':'ML','470':'MT','474':'MQ','478':'MR',
    '480':'MU','484':'MX','492':'MC','496':'MN','498':'MD','499':'ME','500':'MS','504':'MA',
    '508':'MZ','512':'OM','516':'NA','520':'NR','524':'NP','528':'NL','530':'AN','531':'CW',
    '533':'AW','540':'NC','548':'VU','554':'NZ','558':'NI','562':'NE','566':'NG','570':'NU',
    '574':'NF','578':'NO','580':'MP','583':'FM','584':'MH','585':'PW','586':'PK','591':'PA',
    '598':'PG','600':'PY','604':'PE','608':'PH','612':'PN','616':'PL','620':'PT','624':'GW',
    '626':'TL','630':'PR','634':'QA','638':'RE','642':'RO','643':'RU','646':'RW','652':'BL',
    '654':'SH','659':'KN','660':'AI','662':'LC','663':'MF','666':'PM','670':'VC','674':'SM',
    '678':'ST','682':'SA','686':'SN','688':'RS','690':'SC','694':'SL','702':'SG','703':'SK',
    '704':'VN','705':'SI','706':'SO','710':'ZA','716':'ZW','720':'YE','724':'ES','728':'SS',
    '729':'SD','732':'EH','740':'SR','744':'SJ','748':'SZ','752':'SE','756':'CH','760':'SY',
    '762':'TJ','764':'TH','768':'TG','772':'TK','776':'TO','780':'TT','784':'AE','788':'TN',
    '792':'TR','795':'TM','796':'TC','798':'TV','800':'UG','804':'UA','807':'MK','818':'EG',
    '826':'GB','831':'GG','832':'JE','833':'IM','834':'TZ','840':'US','850':'VI','854':'BF',
    '858':'UY','860':'UZ','862':'VE','876':'WF','882':'WS','887':'YE','894':'ZM',
    '-99':'CY','900':'XK'
};

// ============================================================
// COUNTRY NAMES (Russian)
// ============================================================
var COUNTRY_NAMES = {
    'AF':'Афганистан','AL':'Албания','DZ':'Алжир','AD':'Андорра','AO':'Ангола',
    'AG':'Антигуа и Барбуда','AR':'Аргентина','AM':'Армения','AU':'Австралия','AT':'Австрия',
    'AZ':'Азербайджан','BS':'Багамы','BH':'Бахрейн','BD':'Бангладеш','BB':'Барбадос',
    'BY':'Беларусь','BE':'Бельгия','BZ':'Белиз','BJ':'Бенин','BT':'Бутан',
    'BO':'Боливия','BA':'Босния и Герцеговина','BW':'Ботсвана','BR':'Бразилия','BN':'Бруней',
    'BG':'Болгария','BF':'Буркина-Фасо','BI':'Бурунди','CV':'Кабо-Верде','KH':'Камбоджа',
    'CM':'Камерун','CA':'Канада','CF':'ЦАР','TD':'Чад','CL':'Чили',
    'CN':'Китай','CO':'Колумбия','KM':'Коморы','CG':'Конго','CD':'ДР Конго',
    'CR':'Коста-Рика','CI':'Кот-д\'Ивуар','HR':'Хорватия','CU':'Куба','CY':'Кипр',
    'CZ':'Чехия','DK':'Дания','DJ':'Джибути','DM':'Доминика','DO':'Доминикана',
    'EC':'Эквадор','EG':'Египет','SV':'Сальвадор','GQ':'Экваториальная Гвинея','ER':'Эритрея',
    'EE':'Эстония','SZ':'Эсватини','ET':'Эфиопия','FJ':'Фиджи','FI':'Финляндия',
    'FR':'Франция','GA':'Габон','GM':'Гамбия','GE':'Грузия','DE':'Германия',
    'GH':'Гана','GR':'Греция','GD':'Гренада','GT':'Гватемала','GN':'Гвинея',
    'GW':'Гвинея-Бисау','GY':'Гайана','HT':'Гаити','HN':'Гондурас','HU':'Венгрия',
    'IS':'Исландия','IN':'Индия','ID':'Индонезия','IR':'Иран','IQ':'Ирак',
    'IE':'Ирландия','IL':'Израиль','IT':'Италия','JM':'Ямайка','JP':'Япония',
    'JO':'Иордания','KZ':'Казахстан','KE':'Кения','KI':'Кирибати','KP':'Северная Корея',
    'KR':'Южная Корея','KW':'Кувейт','KG':'Киргизия','LA':'Лаос','LV':'Латвия',
    'LB':'Ливан','LS':'Лесото','LR':'Либерия','LY':'Ливия','LI':'Лихтенштейн',
    'LT':'Литва','LU':'Люксембург','MG':'Мадагаскар','MW':'Малави','MY':'Малайзия',
    'MV':'Мальдивы','ML':'Мали','MT':'Мальта','MH':'Маршалловы Острова','MR':'Мавритания',
    'MU':'Маврикий','MX':'Мексика','FM':'Микронезия','MD':'Молдова','MC':'Монако',
    'MN':'Монголия','ME':'Черногория','MA':'Марокко','MZ':'Мозамбик','MM':'Мьянма',
    'NA':'Намибия','NR':'Науру','NP':'Непал','NL':'Нидерланды','NZ':'Новая Зеландия',
    'NI':'Никарагуа','NE':'Нигер','NG':'Нигерия','MK':'Северная Македония','NO':'Норвегия',
    'OM':'Оман','PK':'Пакистан','PW':'Палау','PA':'Панама','PG':'Папуа — Новая Гвинея',
    'PY':'Парагвай','PE':'Перу','PH':'Филиппины','PL':'Польша','PT':'Португалия',
    'QA':'Катар','RO':'Румыния','RU':'Россия','RW':'Руанда','KN':'Сент-Китс и Невис',
    'LC':'Сент-Люсия','VC':'Сент-Винсент и Гренадины','WS':'Самоа','SM':'Сан-Марино',
    'ST':'Сан-Томе и Принсипи','SA':'Саудовская Аравия','SN':'Сенегал','RS':'Сербия',
    'SC':'Сейшелы','SL':'Сьерра-Леоне','SG':'Сингапур','SK':'Словакия','SI':'Словения',
    'SB':'Соломоновы Острова','SO':'Сомали','ZA':'ЮАР','SS':'Южный Судан','ES':'Испания',
    'LK':'Шри-Ланка','SD':'Судан','SR':'Суринам','SE':'Швеция','CH':'Швейцария',
    'SY':'Сирия','TW':'Тайвань','TJ':'Таджикистан','TZ':'Танзания','TH':'Таиланд',
    'TL':'Восточный Тимор','TG':'Того','TO':'Тонга','TT':'Тринидад и Тобаго','TN':'Тунис',
    'TR':'Турция','TM':'Туркменистан','TV':'Тувалу','UG':'Уганда','UA':'Украина',
    'AE':'ОАЭ','GB':'Великобритания','US':'США','UY':'Уругвай','UZ':'Узбекистан',
    'VU':'Вануату','VA':'Ватикан','VE':'Венесуэла','VN':'Вьетнам','YE':'Йемен',
    'ZM':'Замбия','ZW':'Зимбабве','XK':'Косово','PS':'Палестина','EH':'Западная Сахара',
    'GL':'Гренландия','NC':'Новая Каледония','PF':'Французская Полинезия','PR':'Пуэрто-Рико',
    'FK':'Фолклендские острова','GF':'Французская Гвиана','TF':'Французские Южные территории',
    'AQ':'Антарктида','BM':'Бермуды','CW':'Кюрасао','AW':'Аруба','SJ':'Шпицберген'
};
