// =============================================================
// Place ID Check API Service
// =============================================================
// Kurulum:
//   npm install
//
// Çalıştırma:
//   node index.js
//
// .env dosyası oluşturun:
//   PORT=3000
//   API_TOKEN=your-secret-token-here
// =============================================================

require('dotenv').config();
const express = require('express');
// Axios yerine native curl kullanacağız
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'default-secret-token';

// Middleware: JSON body parser
app.use(express.json());

// Request headers - PHP'deki $Header dizisinin birebir karşılığı
// Curl komutuna argüman olarak eklenecek
const UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0';
const HeadersMap = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.8,en-US;q=0.5,en;q=0.3',
    'DNT': '1',
    'Sec-GPC': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
    // Referer dinamik eklenecek
};

/**
 * Token doğrulama middleware
 */
function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Authorization header eksik'
        });
    }

    const tokenValue = token.startsWith('Bearer ') ? token.slice(7) : token;

    if (tokenValue !== API_TOKEN) {
        return res.status(403).json({
            success: false,
            error: 'Geçersiz token'
        });
    }

    next();
}

/**
 * Recursive olarak JSON ağacında website bilgisini arar.
 */
function findWebsiteInTree(data, depth = 0) {
    if (depth > 50) return null;
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data)) {
        if (data.length >= 2 && typeof data[0] === 'string' && typeof data[1] === 'string') {
            const url = data[0];
            const text = data[1];

            if (url.startsWith('http://') || url.startsWith('https://')) {
                const isGoogleMapLink = url.includes('google.com/maps') || url.includes('google.com/local') || url.includes('ggpht.com');
                if (!isGoogleMapLink) {
                    return url;
                }
            }
        }

        for (const item of data) {
            const res = findWebsiteInTree(item, depth + 1);
            if (res) return res;
        }
    }
    return null;
}

/**
 * Native Curl ile istek atar
 */
async function curlFetch(url, referer) {
    // Komut oluşturma
    // -L: Follow redirects
    // -k: Insecure (SSL verify false) - PHP'deki gibi
    // -4: Force IPv4 - PHP'deki gibi
    // --silent: Progress bar gösterme
    let cmd = `curl -L -k -4 --silent -A "${UserAgent}"`;
    
    // Headerları ekle
    for (const [key, value] of Object.entries(HeadersMap)) {
        cmd += ` -H "${key}: ${value}"`;
    }
    
    // Referer ekle
    cmd += ` -H "Referer: ${referer}"`;
    
    // URL ekle (son argüman)
    cmd += ` "${url}"`;

    // console.log("Executing Curl:", cmd);

    try {
        const { stdout, stderr } = await execPromise(cmd, { maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer
        if (!stdout && stderr) {
            throw new Error(stderr);
        }
        return stdout;
    } catch (error) {
        throw error;
    }
}

async function PlaceIDSorgula(PlaceIDBilgisi) {
    const Baglanti = 'https://www.google.com/maps/place/?q=place_id:' + PlaceIDBilgisi.trim() + '&hl=en';
    const Ref = 'http://' + new URL(Baglanti).host;

    try {
        // Axios yerine Curl kullanıyoruz
        const Kaynak = await curlFetch(Baglanti, Ref);

        // XSSI prefix veya HTML içinden JSON çekme
        let mainJsonString = Kaynak;
        let fromHtml = false;

        if (typeof Kaynak === 'string') {
            if (Kaynak.trim().startsWith(")]}'")) {
                mainJsonString = Kaynak.replace(")]}'", '').trim();
            } else {
                const patterns = [
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*window\.APP_FLAGS/,
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*this\.gbar_/,
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*var\s/,
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*window\./,
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);/
                ];

                let match = null;
                for (const pattern of patterns) {
                    match = Kaynak.match(pattern);
                    if (match && match[1]) {
                        const candidate = match[1].trim();
                        if (candidate.startsWith('[') && candidate.endsWith(']')) {
                            mainJsonString = candidate;
                            fromHtml = true;
                            break;
                        }
                    }
                }

                if (!fromHtml && !match) {
                    console.log(`[HATA] HTML yanıtında APP_INITIALIZATION_STATE bulunamadı. (Bot Algılama?)`);
                    return { success: false, PlaceIDDurum: 4, WebSitesi: null, error: 'Google Maps verisi bulunamadı (Regex eşleşmedi)' };
                }
            }
        }

        let mainData;
        try {
            mainData = JSON.parse(mainJsonString);
        } catch (e) {
            console.log(`[HATA] JSON parse hatası: ${e.message}`);
            return { success: false, PlaceIDDurum: 4, WebSitesi: null, error: 'JSON parse hatası' };
        }

        let WebSitesi = findWebsiteInTree(mainData);

        if (!WebSitesi) {
            if (Array.isArray(mainData)) {
                if (!mainData[3] || (Array.isArray(mainData[3]) && mainData[3].length === 0)) {
                    console.log(`[UYARI] Beklenen veri indeksi (mainData[3]) boş veya eksik. Lite yanıt.`);
                } else if (mainData[3][6]) {
                    if (typeof mainData[3][6] === 'string' && mainData[3][6].startsWith(")]}'")) {
                        try {
                            const innerData = JSON.parse(mainData[3][6].replace(")]}'", '').trim());
                            WebSitesi = findWebsiteInTree(innerData);
                        } catch (e) { }
                    } else if (typeof mainData[3][6] === 'string') {
                        try {
                            const innerData = JSON.parse(mainData[3][6]);
                            WebSitesi = findWebsiteInTree(innerData);
                        } catch (e) { }
                    }
                }
            }
        }

        let PlaceIDDurum = WebSitesi ? 1 : 0;

        return {
            success: true,
            PlaceIDDurum: PlaceIDDurum,
            WebSitesi: WebSitesi,
            error: null
        };

    } catch (error) {
        console.error(`[HATA] Curl İsteği Başarısız: ${error.message}`);
        return {
            success: false,
            PlaceIDDurum: 4,
            WebSitesi: null,
            error: 'İstek başarısız: ' + error.message
        };
    }
}

function domainEslesiyor(WebSitesi, domain) {
    if (!WebSitesi || !domain) return false;
    return WebSitesi.toLowerCase().includes(domain.toLowerCase());
}

app.post('/api/check', authMiddleware, async (req, res) => {
    const { placeid, domain } = req.body;

    if (!placeid || typeof placeid !== 'string' || placeid.trim() === '') {
        return res.status(400).json({ success: false, error: 'placeid zorunlu' });
    }
    if (!domain || typeof domain !== 'string' || domain.trim() === '') {
        return res.status(400).json({ success: false, error: 'domain zorunlu' });
    }

    try {
        const sonuc = await PlaceIDSorgula(placeid.trim());

        if (!sonuc.success) {
            return res.status(200).json({
                success: true,
                data: {
                    placeid: placeid.trim(),
                    domain: domain.trim(),
                    websiteFound: false,
                    website: null,
                    domainMatch: false,
                    status: sonuc.PlaceIDDurum,
                    error: sonuc.error
                }
            });
        }

        const websiteFound = !!sonuc.WebSitesi;
        const domainMatch = domainEslesiyor(sonuc.WebSitesi, domain.trim());

        return res.status(200).json({
            success: true,
            data: {
                placeid: placeid.trim(),
                domain: domain.trim(),
                websiteFound: websiteFound,
                website: sonuc.WebSitesi,
                domainMatch: domainMatch,
                status: sonuc.PlaceIDDurum
            }
        });

    } catch (error) {
        console.error('Hata:', error);
        return res.status(500).json({ success: false, error: 'Sunucu hatası' });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ success: true, message: 'Service is running' });
});

app.use((req, res) => res.status(404).json({ success: false, error: 'Endpoint bulunamadı' }));

app.listen(PORT, () => {
    console.log(`Place ID Check API servisi çalışıyor: http://localhost:${PORT}`);
});
