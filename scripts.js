const KanjiInput = document.getElementById('KanjiInput');
const GoogleLink = document.getElementById('GoogleLink');
const JishoLink = document.getElementById('JishoLink');
const KanjiNum = document.getElementById('KanjiNum');
const DictionaryStatus = document.getElementById('DictionaryStatus');
const DictionaryResults = document.getElementById('DictionaryResults');
const SearchButton = document.getElementById('SearchButton');
const ClearButton = document.getElementById('ClearButton');

const JAPANESE_WIKIPEDIA_API_URL = 'https://ja.wikipedia.org/w/api.php';
const ENGLISH_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

let debounceTimer = null;
let currentRequestId = 0;
const orientationQuery = window.matchMedia('(orientation: landscape)');

function applyOrientationLayout() {
    document.body.dataset.orientation = orientationQuery.matches ? 'landscape' : 'portrait';
    adjustInputVisibility();
}

function adjustInputVisibility() {
    const orientation = document.body.dataset.orientation || 'portrait';
    const minSize = orientation === 'landscape' ? 44 : 52;
    const maxSize = orientation === 'landscape' ? 180 : 220;
    const lengthPenalty = Math.max(0, KanjiInput.value.length - 4) * 3;
    const dynamicSize = Math.max(minSize, maxSize - lengthPenalty);

    KanjiInput.style.fontSize = `${dynamicSize}px`;

    KanjiInput.style.height = 'auto';
    const maxHeight = window.innerHeight * 0.7;
    const idealHeight = Math.max(window.innerHeight * 0.5, KanjiInput.scrollHeight);
    KanjiInput.style.height = `${Math.min(maxHeight, idealHeight)}px`;
}

function setStatus(text, isError = false) {
    DictionaryStatus.textContent = text;
    DictionaryStatus.classList.toggle('error', isError);
}

function clearResults() {
    DictionaryResults.textContent = '';
}

function getResultLimit() {
    const parsed = Number.parseInt(KanjiNum.value, 10);
    if (!Number.isInteger(parsed)) {
        return 4;
    }
    return Math.min(10, Math.max(1, parsed));
}

function updateExternalLinks() {
    const value = KanjiInput.value.trim();
    const query = encodeURIComponent(value);

    GoogleLink.href = `https://www.google.com/search?q=${query}`;
    GoogleLink.textContent = value ? `Googleで「${value}」を開く` : 'Googleで開く';

    JishoLink.href = `https://jisho.org/search/${query}`;
    JishoLink.textContent = value ? `Jishoで「${value}」を開く` : 'Jishoで開く';
}

function createResultItem(title, description, source) {
    const li = document.createElement('li');

    const titleEl = document.createElement('span');
    titleEl.className = 'result-title';
    titleEl.textContent = title;

    const bodyEl = document.createElement('span');
    bodyEl.textContent = description;

    const sourceEl = document.createElement('span');
    sourceEl.className = 'result-meta';
    sourceEl.textContent = `出典: ${source}`;

    li.appendChild(titleEl);
    li.appendChild(bodyEl);
    li.appendChild(sourceEl);
    return li;
}

function renderResults(entries) {
    clearResults();

    for (const entry of entries) {
        DictionaryResults.appendChild(createResultItem(entry.title, entry.description, entry.source));
    }
}

function parseJapaneseWikipediaEntries(searchData, extractData, limit) {
    if (!searchData || !searchData.query || !Array.isArray(searchData.query.search)) {
        return [];
    }

    const pagesByTitle = {};
    if (extractData && extractData.query && extractData.query.pages) {
        for (const page of Object.values(extractData.query.pages)) {
            if (page && page.title) {
                pagesByTitle[page.title] = page;
            }
        }
    }

    const entries = [];

    for (const item of searchData.query.search.slice(0, limit)) {
        const title = item.title || '';
        const snippet = (item.snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const page = pagesByTitle[title];
        const extract = page && typeof page.extract === 'string'
            ? page.extract.split('\n').map((line) => line.trim()).find((line) => line)
            : '';

        entries.push({
            title,
            description: extract || snippet || '説明が見つかりませんでした。',
            source: '日本語Wikipedia (MediaWiki API)'
        });
    }

    return entries;
}

function parseEnglishEntries(data, limit) {
    if (!Array.isArray(data)) {
        return [];
    }

    const entries = [];

    for (const entry of data) {
        const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];

        for (const meaning of meanings) {
            const definitions = Array.isArray(meaning.definitions) ? meaning.definitions : [];

            for (const definition of definitions) {
                if (!definition || !definition.definition) {
                    continue;
                }

                entries.push({
                    title: `${entry.word} (${meaning.partOfSpeech || 'word'})`,
                    description: definition.definition,
                    source: 'dictionaryapi.dev'
                });

                if (entries.length >= limit) {
                    return entries;
                }
            }
        }
    }

    return entries;
}

function isLikelyJapanese(text) {
    return /[\u3040-\u30ff\u3400-\u9faf]/.test(text);
}

async function fetchJapaneseDictionary(word, limit) {
    const searchParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: word,
        srlimit: String(limit),
        utf8: '1',
        origin: '*'
    });

    const searchResponse = await fetch(`${JAPANESE_WIKIPEDIA_API_URL}?${searchParams.toString()}`);
    if (!searchResponse.ok) {
        throw new Error('Japanese dictionary request failed');
    }

    const searchData = await searchResponse.json();
    const searchItems = searchData && searchData.query && Array.isArray(searchData.query.search)
        ? searchData.query.search
        : [];

    if (searchItems.length === 0) {
        return [];
    }

    const titles = searchItems.slice(0, limit).map((item) => item.title).join('|');
    const extractParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'extracts',
        explaintext: '1',
        exintro: '1',
        redirects: '1',
        titles,
        origin: '*'
    });

    const extractResponse = await fetch(`${JAPANESE_WIKIPEDIA_API_URL}?${extractParams.toString()}`);
    if (!extractResponse.ok) {
        throw new Error('Japanese dictionary extract request failed');
    }

    const extractData = await extractResponse.json();
    return parseJapaneseWikipediaEntries(searchData, extractData, limit);
}

async function fetchEnglishDictionary(word, limit) {
    const response = await fetch(ENGLISH_API_URL + encodeURIComponent(word));
    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return parseEnglishEntries(data, limit);
}

function setLoadingState(isLoading) {
    SearchButton.disabled = isLoading;
    SearchButton.textContent = isLoading ? '検索中...' : '辞書検索';
}

async function updateDictionaryResults() {
    const word = KanjiInput.value.trim();
    const requestId = ++currentRequestId;

    if (!word) {
        setStatus('単語を入力すると辞書候補を表示します');
        clearResults();
        return;
    }

    setLoadingState(true);
    setStatus('辞書を検索中...');

    const limit = getResultLimit();

    try {
        const results = isLikelyJapanese(word)
            ? await fetchJapaneseDictionary(word, limit)
            : await fetchEnglishDictionary(word, limit);

        if (requestId !== currentRequestId) {
            return;
        }

        if (results.length === 0) {
            setStatus('候補が見つかりませんでした。外部リンクで再検索してください');
            clearResults();
            return;
        }

        setStatus(`候補 ${results.length} 件`);
        renderResults(results);
    } catch (error) {
        if (requestId !== currentRequestId) {
            return;
        }

        setStatus('辞書の取得に失敗しました。接続状況を確認してください', true);
        clearResults();
    } finally {
        setLoadingState(false);
    }
}

function scheduleDictionaryUpdate() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
        updateDictionaryResults();
    }, 350);
}

function clearAll() {
    KanjiInput.value = '';
    adjustInputVisibility();
    updateExternalLinks();
    setStatus('単語を入力すると辞書候補を表示します');
    clearResults();
    KanjiInput.focus();
}

updateExternalLinks();
setStatus('単語を入力すると辞書候補を表示します');
applyOrientationLayout();
adjustInputVisibility();

KanjiInput.addEventListener('input', () => {
    adjustInputVisibility();
    updateExternalLinks();
    scheduleDictionaryUpdate();
});

KanjiNum.addEventListener('input', scheduleDictionaryUpdate);
SearchButton.addEventListener('click', updateDictionaryResults);
ClearButton.addEventListener('click', clearAll);

KanjiInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
        return;
    }

    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
        window.open(GoogleLink.href, '_blank', 'noopener');
        return;
    }

    updateDictionaryResults();
});

if (typeof orientationQuery.addEventListener === 'function') {
    orientationQuery.addEventListener('change', applyOrientationLayout);
} else if (typeof orientationQuery.addListener === 'function') {
    orientationQuery.addListener(applyOrientationLayout);
}

window.addEventListener('resize', applyOrientationLayout);
