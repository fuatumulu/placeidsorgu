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
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'default-secret-token';

// Middleware: JSON body parser
app.use(express.json());

// Request headers - PHP'deki $Header dizisinin birebir karşılığı
const Header = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
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

    // Bearer token formatı: "Bearer <token>"
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
 * Aranan Pattern: [URL, DomainText, ...]
 * @param {Array|Object} data 
 * @param {number} depth 
 * @returns {string|null} Bulunan URL
 */
function findWebsiteInTree(data, depth = 0) {
    if (depth > 50) return null; // Derinlik sınırı artırıldı (Google Maps verisi derin olabilir)
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data)) {
        // Pattern kontrolü: ["http...", "string", ...]
        if (data.length >= 2 && typeof data[0] === 'string' && typeof data[1] === 'string') {
            const url = data[0];
            const text = data[1];

            if (url.startsWith('http://') || url.startsWith('https://')) {
                // Google harita/içerik linklerini ele (Çok kaba filtreleme, dikkatli olunmalı)
                const isGoogleMapLink = url.includes('google.com/maps') || url.includes('google.com/local') || url.includes('ggpht.com');

                if (!isGoogleMapLink) {
                    // Bulundu!
                    // Güvenilirlik kontrolü: text url içinde geçiyor mu veya benzer mi?
                    // Genellikle text domain adıdır.
                    return url;
                }
            }
        }

        // Alt elemanları gez
        for (const item of data) {
            const res = findWebsiteInTree(item, depth + 1);
            if (res) return res;
        }
    }

    return null;
}

/**
 * PlaceIDDurum değerini bulmaya çalışır
 * Pattern: [..., [...], ..., INT_STATUS] (genellikle bir integer)
 * PHP kodunda 78. index veya 227. index civarıydı.
 * @param {Array} data 
 */
function findStatusInTree(data) {
    // Bu değer çok spesifik olduğu için genel bir arama zor.
    // Şimdilik eski mantıkla belirli path'lere bakmak veya "Claim this business" stringini aramak mantıklı olabilir.
    // PHP kodunda `PlaceIDDurum` claim durumu (sahip olunan/olunmayan) ile ilgiliydi.
    // Eğer bulamazsak 4 dönüyoruz.

    if (!Array.isArray(data)) return null;

    // Genellikle büyük array'in içinde spesifik indekslerde olur.
    // User verisinde: 9. index website ise, status nerede?
    // Şimdilik null dönelim, ana fonksiyonda default değer atanır.
    return null;
}

/**
 * Place ID ile Google Maps'den website bilgisini çeker
 * @param {string} PlaceIDBilgisi - Google Place ID
 * @returns {Promise<Object>} - Website bilgisi ve durum
 */
async function PlaceIDSorgula(PlaceIDBilgisi) {

    const Baglanti = 'https://www.google.com/maps/place/?q=place_id:' + PlaceIDBilgisi.trim() + '&hl=en';
    const Ref = new URL(Baglanti).host;

    try {
        // PHP'nin davranışını simüle etmek için:
        // 1. IPv4 zorla (PHP curl genelde v4 tercih eder/ayarlıdır)
        // 2. SSL sertifika kontrolünü kapat (CURLOPT_SSL_VERIFYPEER = false)
        const https = require('https');
        const agent = new https.Agent({  
            rejectUnauthorized: false,
            family: 4
        });

        const axiosConfig = {
            headers: {
                ...Header,
                'Referer': 'http://' + Ref
            },
            httpsAgent: agent, // Agent'ı ekle
            maxRedirects: 5,
            timeout: 30000,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        };

        const response = await axios.get(Baglanti, axiosConfig);

        const Kaynak = response.data;

        // XSSI prefix veya HTML içinden JSON çekme
        let mainJsonString = Kaynak;
        let fromHtml = false;

        if (typeof Kaynak === 'string') {
            if (Kaynak.trim().startsWith(")]}'")) {
                mainJsonString = Kaynak.replace(")]}'", '').trim();
            } else {
                // Regex patternleri (Öncelik sırasına göre)
                // PHP'deki ve testlerdeki varyasyonlar
                const patterns = [
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*window\.APP_FLAGS/, // Orijinal
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*this\.gbar_/,       // Yaygın Yeni
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*var\s/,             // Alternatif
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);\s*window\./,          // Alternatif
                    /window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);/                  // En Geniş
                ];

                let match = null;
                for (const pattern of patterns) {
                    match = Kaynak.match(pattern);
                    if (match && match[1]) {
                        // Basit JSON validasyonu
                        const candidate = match[1].trim();
                        if (candidate.startsWith('[') && candidate.endsWith(']')) {
                            mainJsonString = candidate;
                            fromHtml = true;
                            // console.log(`[DEBUG] Regex eşleşmesi: ${pattern}`);
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

        // Veri bloklarını belirle
        let WebSitesi = null;

        // 1. Doğrudan mainData içinde ara (Recursion)
        WebSitesi = findWebsiteInTree(mainData);

        // 2. Özel index kontrolü: [3][6] (PHP'de kullanılan yol) için özel denetim ve hata logu
        if (!WebSitesi) {
            if (Array.isArray(mainData)) {
                // Veri var mı diye bak (Bot kontrolü)
                if (!mainData[3] || (Array.isArray(mainData[3]) && mainData[3].length === 0)) {
                    console.log(`[UYARI] Beklenen veri indeksi (mainData[3]) boş veya eksik. Google 'Lite' sayfa göndermiş olabilir.`);
                } else if (mainData[3][6]) {
                    // Veri string olarak saklanmış olabilir (XSSI)
                    if (typeof mainData[3][6] === 'string' && mainData[3][6].startsWith(")]}'")) {
                        try {
                            const innerData = JSON.parse(mainData[3][6].replace(")]}'", '').trim());
                            WebSitesi = findWebsiteInTree(innerData);
                        } catch (e) {
                            console.log(`[HATA] İç JSON parse hatası (index 3,6).`);
                        }
                    } else if (typeof mainData[3][6] === 'string') {
                        // Belki direkt JSON stringdir (XSSI prefixsiz)
                        try {
                            const innerData = JSON.parse(mainData[3][6]);
                            WebSitesi = findWebsiteInTree(innerData);
                        } catch (e) {/*ignore*/ }
                    }
                }
            }
        }

        let PlaceIDDurum = 4;
        if (WebSitesi) {
            PlaceIDDurum = 1; // Website var
        } else {
            PlaceIDDurum = 0; // Website yok
        }

        return {
            success: true,
            PlaceIDDurum: PlaceIDDurum,
            WebSitesi: WebSitesi,
            error: null
        };

    } catch (error) {
        console.error(`[HATA] Axios İsteği Başarısız: ${error.message}`);
        return {
            success: false,
            PlaceIDDurum: 4,
            WebSitesi: null,
            error: 'HTTP isteği başarısız: ' + error.message
        };
    }
}

/**
 * Domain eşleşme kontrolü
 */
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
                status: sonuc.PlaceIDDurum // 1: Var, 0: Yok, 4: Hata/Belirsiz
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
    console.log(`Endpoint: POST /api/check`);
});
