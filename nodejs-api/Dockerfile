FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Curl kurulumu (PHP ile birebir aynı bot davranışını sergilemek için)
RUN apk add --no-cache curl

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
