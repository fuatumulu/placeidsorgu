const axios = require('axios');
const fs = require('fs');

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

const url = 'https://www.google.com/maps/place/?q=place_id:ChIJ____xBkKoUcRmKAqH-bhdRU&hl=en';

console.log("Fetching URL:", url);

async function run() {
    try {
        const response = await axios.get(url, {
            headers: Header,
            responseType: 'arraybuffer', // Get raw buffer to avoid encoding issues
            validateStatus: () => true
        });

        console.log("Status:", response.status);
        console.log("Headers:", response.headers);
        console.log("Data Length:", response.data.length);

        fs.writeFileSync('raw_response.html', response.data);
        console.log("Saved to raw_response.html");

    } catch (error) {
        console.error("Error:", error.message);
    }
}

run();
